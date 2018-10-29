import { CradleModel, CradleSchema, EmitterOptions, IConsole, ICradleEmitter, ICradleOperation } from '@gatewayapps/cradle';
import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType';
import { IApolloEmitterOptions } from './IApolloEmitterOptions';
export default class ApolloEmitter implements ICradleEmitter {
    console?: IConsole;
    options: EmitterOptions<IApolloEmitterOptions>;
    getOperation: any;
    private Models;
    private filesEmitted;
    prepareEmitter(options: EmitterOptions<IApolloEmitterOptions>, console: IConsole): Promise<void>;
    emitSchema(schema: CradleSchema): Promise<void>;
    getMutationDefsForModel(model: CradleModel): string;
    getQueryDefsForModel(model: CradleModel): string;
    getTypeDefsForModel(model: CradleModel): string;
    getSchemaForOperationArgs(operationName: string, operation: ICradleOperation): string;
    getGraphqlTypeFromPropertyType(propertyType: PropertyType | string): any;
    private getStubMethodFor;
    private writeResolversForModel;
    private writeTypeDefsForModel;
    private getIdentifiersForModel;
    private getArgsTypeNameForOperation;
    /**
     * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
     * this method does nothing
     * @param contents contents of file to write
     * @param path path to file
     */
    private writeContentsToFile;
}
//# sourceMappingURL=ApolloEmitter.d.ts.map