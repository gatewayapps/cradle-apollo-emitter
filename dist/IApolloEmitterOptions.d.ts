import { CradleModel } from '@gatewayapps/cradle';
import ModelReference from '@gatewayapps/cradle/dist/lib/ModelReference';
export interface IApolloEmitterOptions {
    readonly overwriteExisting: boolean;
    readonly outputPath: string;
    readonly modelOutputPath?: (modelName: string) => string;
    readonly isModelToplevel?: (model: CradleModel) => boolean;
    readonly getImportsForModel?: (model: CradleModel) => string[];
    readonly getRootImports: (topLevelModels: CradleModel[]) => string[];
    readonly getResolverForModel: (model: CradleModel, resolverType: 'Single' | 'Paginated') => any;
    readonly getResolverForReference?: (model: CradleModel, referenceName: string, modelReference: ModelReference) => any;
    readonly onComplete: (filesEmitted: string[]) => void;
}
//# sourceMappingURL=IApolloEmitterOptions.d.ts.map