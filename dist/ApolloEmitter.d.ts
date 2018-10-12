import { CradleModel, CradleSchema, EmitterOptions, IConsole, ICradleEmitter } from '@gatewayapps/cradle';
import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType';
import { IApolloEmitterOptions } from './IApolloEmitterOptions';
export default class ApolloEmitter implements ICradleEmitter {
    console?: IConsole;
    options: EmitterOptions<IApolloEmitterOptions>;
    private Models;
    private filesEmitted;
    prepareEmitter(options: EmitterOptions<IApolloEmitterOptions>, console: IConsole): Promise<void>;
    emitSchema(schema: CradleSchema): Promise<void>;
    getResolversForModel(model: CradleModel): Record<string, string>;
    getSchemaForModel(model: CradleModel): string;
    getGraphqlTypeFromPropertyType(propertyType: PropertyType | string): any;
    /**
     * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
     * this method does nothing
     * @param contents contents of file to write
     * @param path path to file
     */
    private writeContentsToFile;
    private emitToMultipleFiles;
    private getRootQuery;
    private getRootImports;
    private getRootResolvers;
    private emitToSingleFile;
}
//# sourceMappingURL=ApolloEmitter.d.ts.map