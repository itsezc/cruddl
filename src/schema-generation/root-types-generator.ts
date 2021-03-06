import memorize from 'memorize-decorator';
import { SchemaOptions } from '../config/interfaces';
import { Model } from '../model';
import { CreateInputTypeGenerator } from './create-input-types';
import { EnumTypeGenerator } from './enum-type-generator';
import { FilterAugmentation } from './filter-augmentation';
import { FilterTypeGenerator } from './filter-input-types';
import { FlexSearchFilterTypeGenerator } from './flex-search-filter-input-types/generator';
import { FlexSearchGenerator } from './flex-search-generator';
import { MetaFirstAugmentation } from './limit-augmentation';
import { ListAugmentation } from './list-augmentation';
import { MetaTypeGenerator } from './meta-type-generator';
import { MutationTypeGenerator } from './mutation-type-generator';
import { OrderByAndPaginationAugmentation } from './order-by-and-pagination-augmentation';
import { OrderByEnumGenerator } from './order-by-enum-generator';
import { OutputTypeGenerator } from './output-type-generator';
import { QueryNodeObjectType } from './query-node-object-type';
import { QueryTypeGenerator } from './query-type-generator';
import { UpdateInputTypeGenerator } from './update-input-types';

export class RootTypesGenerator {
    constructor(private readonly options: SchemaOptions = {}) {
    }

    private readonly enumTypeGenerator = new EnumTypeGenerator();
    private readonly filterTypeGenerator = new FilterTypeGenerator(this.enumTypeGenerator);
    private readonly flexSearchFilterTypeGenerator = new FlexSearchFilterTypeGenerator(this.enumTypeGenerator);
    private readonly orderByEnumGenerator = new OrderByEnumGenerator({ maxRootEntityDepth: this.options.maxOrderByRootEntityDepth });
    private readonly orderByAugmentation = new OrderByAndPaginationAugmentation(this.orderByEnumGenerator);
    private readonly filterAugmentation = new FilterAugmentation(this.filterTypeGenerator);
    private readonly listAugmentation = new ListAugmentation(this.filterAugmentation, this.orderByAugmentation);
    private readonly metaFirstAugmentation = new MetaFirstAugmentation();

    private readonly metaTypeGenerator = new MetaTypeGenerator();
    private readonly outputTypeGenerator = new OutputTypeGenerator(this.listAugmentation, this.filterAugmentation,
        this.enumTypeGenerator, this.orderByEnumGenerator, this.metaTypeGenerator);
    private readonly flexSearchGenerator = new FlexSearchGenerator(this.flexSearchFilterTypeGenerator, this.outputTypeGenerator, this.listAugmentation, this.filterAugmentation);
    private readonly createTypeGenerator = new CreateInputTypeGenerator(this.enumTypeGenerator);
    private readonly updateTypeGenerator = new UpdateInputTypeGenerator(this.enumTypeGenerator, this.createTypeGenerator);
    private readonly queryTypeGenerator = new QueryTypeGenerator(this.outputTypeGenerator, this.listAugmentation,
        this.filterAugmentation, this.metaFirstAugmentation, this.metaTypeGenerator, this.flexSearchGenerator);

    private readonly mutationTypeGenerator = new MutationTypeGenerator(this.outputTypeGenerator, this.createTypeGenerator,
        this.updateTypeGenerator, this.listAugmentation);

    @memorize()
    generateQueryType(model: Model): QueryNodeObjectType {
        return this.queryTypeGenerator.generate(model.rootNamespace);
    }

    @memorize()
    generateMutationType(model: Model): QueryNodeObjectType {
        return this.mutationTypeGenerator.generate(model.rootNamespace);
    }

}
