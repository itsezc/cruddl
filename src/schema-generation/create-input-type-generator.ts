import { GraphQLInputType, GraphQLList, GraphQLNonNull } from 'graphql';
import { flatMap, fromPairs, toPairs } from 'lodash';
import memorize from 'memorize-decorator';
import { ChildEntityType, EntityExtensionType, Field, ObjectType, RootEntityType, ValueObjectType } from '../model';
import { ENTITY_CREATED_AT, ENTITY_UPDATED_AT, ID_FIELD } from '../schema/schema-defaults';
import { AnyValue, PlainObject } from '../utils/utils';
import { EnumTypeGenerator } from './enum-type-generator';
import { TypedInputFieldBase, TypedInputObjectType } from './typed-input-object-type';
import uuid = require('uuid');

function getCurrentISODate() {
    return new Date().toISOString();
}

export class CreateObjectInputType extends TypedInputObjectType<CreateInputField> {
    constructor(
        name: string,
        fields: ReadonlyArray<CreateInputField>
    ) {
        super(name, fields);
    }

    prepareValue(value: PlainObject): PlainObject {
        const applicableFields = this.getApplicableInputFields(value);
        const properties = [
            ...flatMap(applicableFields, field => toPairs(field.getProperties(value[field.name]))),
            ...toPairs(this.getAdditionalProperties(value))
        ];
        return fromPairs(properties);
    }

    protected getAdditionalProperties(value: PlainObject): PlainObject {
        return {};
    }

    collectAffectedFields(value: PlainObject, fields: Set<Field>) {
        this.getApplicableInputFields(value).forEach(field => field.collectAffectedFields(value[field.name], fields));
    }

    getAffectedFields(value: PlainObject): ReadonlyArray<Field> {
        const fields = new Set<Field>();
        this.collectAffectedFields(value, fields);
        return Array.from(fields);
    }

    private getApplicableInputFields(value: PlainObject): ReadonlyArray<CreateInputField> {
        return this.fields.filter(field => field.name in value || field.appliesToMissingFields());
    }
}

export class CreateRootEntityInputType extends CreateObjectInputType {
    getAdditionalProperties() {
        const now = getCurrentISODate();
        return {
            [ENTITY_CREATED_AT]: now,
            [ENTITY_UPDATED_AT]: now
        };
    }

    // getRelationAddRemoveStatements() // TODO
}

export class CreateChildEntityInputType extends CreateObjectInputType {
    getAdditionalProperties() {
        const now = getCurrentISODate();
        return {
            [ID_FIELD]: uuid(),
            [ENTITY_CREATED_AT]: now,
            [ENTITY_UPDATED_AT]: now
        };
    }
}

export interface CreateInputField extends TypedInputFieldBase<CreateInputField> {
    getProperties(value: AnyValue): PlainObject;

    collectAffectedFields(value: AnyValue, fields: Set<Field>): void;

    appliesToMissingFields(): boolean;
}

export class BasicCreateInputField implements CreateInputField {
    constructor(
        public readonly field: Field,
        public readonly inputType: GraphQLInputType | CreateObjectInputType
    ) {
    }

    get name() {
        return this.field.name;
    }

    getProperties(value: AnyValue) {
        if (value === undefined && this.field.hasDefaultValue) {
            value = this.field.defaultValue;
        }

        value = this.coerceValue(value);

        return {
            [this.field.name]: value
        };
    }

    protected coerceValue(value: AnyValue): AnyValue {
        return value;
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        if (value === undefined) {
            // don't consider this field if it is just set to its default value
            // this enables permission-restricted fields with a non-critical default value
            return;
        }

        fields.add(this.field);
    }

    appliesToMissingFields() {
        return this.field.hasDefaultValue;
    }
}

export class BasicListCreateInputField extends BasicCreateInputField {
    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value === null) {
            // null is not a valid list value - if the user specified it, coerce it to [] to not have a mix of [] and
            // null in the database
            return [];
        }
        return value;
    }
}

export class ObjectCreateInputField extends BasicCreateInputField {
    constructor(
        field: Field,
        public readonly objectInputType: CreateObjectInputType,
        inputType?: GraphQLInputType
    ) {
        super(field, inputType || objectInputType.getInputType());
    }

    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value == undefined) {
            return value;
        }
        return this.objectInputType.prepareValue(value);
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        super.collectAffectedFields(value, fields);
        if (value == undefined) {
            return;
        }

        this.objectInputType.collectAffectedFields(value, fields);
    }
}

export class ObjectListCreateInputField extends BasicCreateInputField {
    constructor(
        field: Field,
        public readonly objectInputType: CreateObjectInputType
    ) {
        super(field, new GraphQLList(new GraphQLNonNull(objectInputType.getInputType())));
    }

    protected coerceValue(value: AnyValue): AnyValue {
        value = super.coerceValue(value);
        if (value === null) {
            // null is not a valid list value - if the user specified it, coerce it to [] to not have a mix of [] and
            // null in the database
            return [];
        }
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value)) {
            throw new Error(`Expected value for "${this.name}" to be an array, but is "${typeof value}"`);
        }
        return value.map(value => this.objectInputType.prepareValue(value));
    }

    collectAffectedFields(value: AnyValue, fields: Set<Field>) {
        super.collectAffectedFields(value, fields);
        if (value == undefined) {
            return;
        }
        if (!Array.isArray(value)) {
            throw new Error(`Expected value for "${this.name}" to be an array, but is "${typeof value}"`);
        }

        value.forEach(value => this.objectInputType.collectAffectedFields(value, fields));
    }
}

export class CreateInputTypeGenerator {
    constructor(
        private readonly enumTypeGenerator: EnumTypeGenerator
    ) {
    }

    @memorize()
    generate(type: ObjectType): CreateObjectInputType {
        if (type.isRootEntityType) {
            return this.generateForRootEntityType(type);
        }
        if (type.isChildEntityType) {
            return this.generateForChildEntityType(type);
        }

        return this.generateForSimpleObjectType(type);
    }

    @memorize()
    generateForRootEntityType(type: RootEntityType): CreateRootEntityInputType {
        return new CreateRootEntityInputType(`Create${type.name}Input`,
            flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    @memorize()
    generateForChildEntityType(type: ChildEntityType): CreateChildEntityInputType {
        return new CreateChildEntityInputType(`Create${type.name}Input`,
            flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    @memorize()
    private generateForSimpleObjectType(type: EntityExtensionType | ValueObjectType): CreateObjectInputType {
        // TODO when implementing update input types, only use one input type for create+update
        return new CreateObjectInputType(`${type.name}Input`,
            flatMap(type.fields, (field: Field) => this.generateFields(field)));
    }

    private generateFields(field: Field): CreateInputField[] {
        if (field.isSystemField) {
            return [];
        }

        if (field.type.isScalarType || field.type.isEnumType) {
            const inputType = field.type.isEnumType ? this.enumTypeGenerator.generate(field.type) : field.type.graphQLScalarType;
            if (field.isList) {
                // don't allow null values in lists
                return [new BasicListCreateInputField(field, new GraphQLList(new GraphQLNonNull(inputType)))];
            } else {
                return [new BasicCreateInputField(field, inputType)];
            }
        }

        if (field.type.isRootEntityType) {
            if (field.isRelation) {
                // TODO relations
                return [];
            } else {
                // reference
                // we intentionally do not check if the referenced object exists (loose coupling), so this behaves just
                // like a regular field
                return [new BasicCreateInputField(field, field.type.getKeyFieldTypeOrThrow().graphQLScalarType)];
            }
        }

        // child entity, value object, entity extension
        const inputType = this.generate(field.type);
        const inputField = field.isList ? new ObjectListCreateInputField(field, inputType) : new ObjectCreateInputField(field, inputType);
        return [inputField];
    }
}
