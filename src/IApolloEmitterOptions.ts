import { CradleModel, ICradleOperation } from '@gatewayapps/cradle'
import ModelReference from '@gatewayapps/cradle/dist/lib/ModelReference'
import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType'

export interface IApolloEmitterOptions {
  readonly overwriteExisting: boolean
  readonly outputDirectory: string
  readonly verbose: boolean
  readonly outputType: string
  readonly isModelToplevel?: (model: CradleModel) => boolean
  readonly shouldTypeIncludeProperty?: (model: CradleModel, propertyName: string, property: PropertyType) => boolean
  readonly shouldTypeIncludeReference?: (model: CradleModel, referenceName: string, modelReference: ModelReference) => boolean
  readonly shouldTypeIncludeOperation?: (model: CradleModel, operationName: string, operation: ICradleOperation) => boolean
  readonly onComplete: (filesEmitted: string[]) => void
}
