import { CradleModel, CradleSchema, EmitterOptions, IConsole, ICradleEmitter, ICradleOperation } from '@gatewayapps/cradle'
import ArrayPropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ArrayPropertyType'
import ModelReferenceType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ModelReferenceType'
import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType'
import colors from 'colors'
import { existsSync, writeFileSync } from 'fs'
import { ensureDirSync, writeFile } from 'fs-extra'
import _ from 'lodash'
import path, { dirname, extname, join } from 'path'
import pluralize from 'pluralize'
import { IApolloEmitterOptions } from './IApolloEmitterOptions'

class ApolloModel {
  public Schema: string
  public Model: CradleModel

  constructor(schema: string, model: CradleModel) {
    this.Schema = schema
    this.Model = model
  }
}

export default class ApolloEmitter implements ICradleEmitter {
  public console?: IConsole
  public options!: EmitterOptions<IApolloEmitterOptions>

  public getOperation
  private Models: ApolloModel[] = []
  private filesEmitted: string[] = []
  public async prepareEmitter(options: EmitterOptions<IApolloEmitterOptions>, console: IConsole) {
    this.console = console
    this.options = options
  }

  public async emitSchema(schema: CradleSchema) {
    console.log('IN EMIT SCHEMA')
    schema.Models.forEach((model) => {
      if (!this.options.options.isModelToplevel || this.options.options.isModelToplevel(model)) {
        this.writeTypeDefsForModel(model)

        if (!this.options.options.shouldGenerateResolvers || this.options.options.shouldGenerateResolvers(model)) {
          this.writeResolversForModel(model)
        }
      }
    })

    // write index.ts file for schema.

    if (this.options.options.onComplete !== undefined) {
      if (this.options.options.verbose) {
        this.console!.log(`Calling onComplete with [ ${this.filesEmitted.join(', ') || 'Empty Array'} ]`)
      }
      this.options.options.onComplete(this.filesEmitted)
    }
  }

  public getMutationDefsForModel(model: CradleModel): string {
    const operationNames = Object.keys(model.Operations)
    const mutationDefs: string[] = []

    operationNames.forEach((opName) => {
      const operationArgs = this.getArgsTypeNameForOperation(opName)
      mutationDefs.push(
        `\t${opName}(data: ${operationArgs}!): ${this.getGraphqlTypeFromPropertyType(model.Operations[opName]!.Returns).replace('!', '')}`
      )
    })

    if (mutationDefs.length > 0) {
      return `type Mutation {
${mutationDefs.join('\n')}
}`
    } else {
      return ''
    }
  }

  public getQueryDefsForModel(model: CradleModel): string {
    const singularQueryNameBase = _.camelCase(pluralize(model.Name, 1))
    const pluralQueryName = _.camelCase(pluralize(model.Name, 2))

    const singularQueries: string[] = []
    const identifiers = this.getIdentifiersForModel(model)
    identifiers.forEach((fieldName) => {
      const queryName = `${singularQueryNameBase}By${_.startCase(fieldName).replace(/\s/g, '')}`
      singularQueries.push(
        `\t${queryName}(${_.camelCase(fieldName)}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fieldName]!)}): ${model.Name}`
      )
    })

    return `type Query {
\t${pluralQueryName}(offset: Int, limit: Int): [${model.Name}]
${singularQueries.join('\n')}
}`
  }

  public getTypeDefsForModel(model: CradleModel): string {
    const localFields: string[] = []
    const fieldNames = Object.keys(model.Properties)
    const referenceNames = model.References ? Object.keys(model.References) : []

    fieldNames.forEach((fn) => {
      if (!this.options.options.shouldTypeIncludeProperty || this.options.options.shouldTypeIncludeProperty(model, fn, model.Properties[fn])) {
        localFields.push(`\t${fn}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fn])}`)
      }
    })
    referenceNames.forEach((rn) => {
      if (!this.options.options.shouldTypeIncludeReference || this.options.options.shouldTypeIncludeReference(model, rn, model.References[rn])) {
        localFields.push(`\t${rn}: ${model.References[rn]!.ForeignModel}`)
      }
    })

    const typeDefs: string[] = []
    typeDefs.push(`type ${model.Name} {
${localFields.join('\n')}
}`)

    if (model.Operations) {
      const operationNames = Object.keys(model.Operations)
      operationNames.forEach((opName) => {
        const operationArgsTypeDef = this.getSchemaForOperationArgs(opName, model.Operations[opName])
        typeDefs.push(operationArgsTypeDef)
      })
    }

    return typeDefs.join('\n\n')
  }

  public getSchemaForOperationArgs(operationName: string, operation: ICradleOperation): string {
    const localFields: string[] = []
    const fieldNames = Object.keys(operation.Arguments)
    fieldNames.forEach((fn) => {
      localFields.push(`\t${fn}: ${this.getGraphqlTypeFromPropertyType(operation.Arguments[fn])}`)
    })

    const argsTypeName = this.getArgsTypeNameForOperation(operationName)
    return `input ${argsTypeName} {
${localFields.join('\n')}
}`
  }

  public getGraphqlTypeFromPropertyType(propertyType: PropertyType | string) {
    const requiredToken = propertyType instanceof PropertyType && propertyType.AllowNull ? '' : '!'

    const propertyTypeName = typeof propertyType === 'string' ? propertyType : propertyType.TypeName

    switch (propertyTypeName) {
      case 'Object': {
        throw new Error('Object types are not supported in cradle-apollo-emitter')
      }
      case 'Array': {
        const arrayProp = propertyType as ArrayPropertyType
        return `[${this.getGraphqlTypeFromPropertyType(arrayProp.MemberType).replace('!', '')}]`
      }
      case 'ModelReference': {
        const modelProp = propertyType as ModelReferenceType
        if (modelProp.ModelType!.TypeName === 'Array') {
          return `[${modelProp.ModelName}]`
        } else {
          return `${modelProp.ModelName}${requiredToken}`
        }
      }
      case 'Binary':
        return `String${requiredToken}`
      case 'Boolean':
        return `Boolean${requiredToken}`
      case 'DateTime':
        return `Date${requiredToken}`
      case 'Decimal':
        return `Float${requiredToken}`
      case 'Integer':
        return `Int${requiredToken}`
      case 'String':
        return `String${requiredToken}`
      case 'UniqueIdentifier':
        return `ID${requiredToken}`
      default:
        throw new Error(`Property type not supported in cradle-apollo-emitter: ${propertyTypeName}`)
    }
  }

  private getStubMethodFor(methodName: string): string {
    return `${methodName}: (obj, args, context, info) => {
      // Insert your ${methodName} implementation here
      throw new Error('${methodName} is not implemented')
    }`
  }

  private writeResolversForModel(model: CradleModel) {
    const singularQueryNameBase = _.camelCase(pluralize(model.Name, 1))
    const pluralQueryName = _.camelCase(pluralize(model.Name, 2))

    const outputFilename = this.options.options.outputType === 'typescript' ? 'resolvers.ts' : 'resolvers.js'

    const modelResolverFilePath = path.join(this.options.options.outputDirectory, model.Name, outputFilename)
    const queries: string[] = [pluralQueryName]
    const mutations: string[] = []
    const references: string[] = []
    const identifiers = this.getIdentifiersForModel(model)
    identifiers.forEach((fieldName) => {
      queries.push(`${singularQueryNameBase}By${_.startCase(fieldName).replace(/\s/g, '')}`)
    })

    queries.forEach((q, qi) => {
      queries[qi] = this.getStubMethodFor(q)
    })

    if (model.Operations) {
      const operationNames = Object.keys(model.Operations)
      operationNames.forEach((opName) => {
        mutations.push(this.getStubMethodFor(opName))
      })
    }

    if (model.References) {
      const referenceNames = Object.keys(model.References)
      referenceNames.forEach((refName) => {
        references.push(this.getStubMethodFor(refName))
      })
    }

    const exportClause = this.options.options.outputType === 'typescript' ? 'export default' : 'module.exports ='

    const resolverBody = `${exportClause} {
  Query: {
    ${queries.join(',\n')}
  },
  Mutation: {
    ${mutations.join(',\n')}
  },
  ${model.Name}: {
    ${references.join(',\n')}
  }
}
    `

    this.writeContentsToFile(resolverBody, modelResolverFilePath)
  }

  private writeTypeDefsForModel(model: CradleModel) {
    const modelTypeDefs = this.getTypeDefsForModel(model)

    const modelQueries =
      (!this.options.options.shouldGenerateResolvers || this.options.options.shouldGenerateResolvers(model)) && this.getQueryDefsForModel(model)

    const modelMutations =
      (!this.options.options.shouldGenerateResolvers || this.options.options.shouldGenerateResolvers(model)) && this.getMutationDefsForModel(model)

    const apolloSchema = _.compact([modelTypeDefs, modelQueries, modelMutations]).join('\n\n')

    const typeDefsPath = join(this.options.options.outputDirectory, model.Name, 'typedefs.graphql')

    this.writeContentsToFile(apolloSchema, typeDefsPath)
  }

  private getIdentifiersForModel(model: CradleModel): string[] {
    const fieldNames = Object.keys(model.Properties)

    return fieldNames.filter((fn) => {
      const field = model.Properties[fn]
      return field && (field.IsPrimaryKey || field.Unique || field.TypeName === 'UniqueIdentifier') && !field.AllowNull
    })
  }

  private getArgsTypeNameForOperation(operationName: string): string {
    return `${_.startCase(operationName).replace(/\s/g, '')}Args`
  }

  /**
   * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
   * this method does nothing
   * @param contents contents of file to write
   * @param path path to file
   */
  private writeContentsToFile(contents: string, filePath: string) {
    if (existsSync(filePath) && !this.options.options.overwriteExisting) {
      this.console!.warn(colors.gray(`Not writing ${filePath} as it already exists and overwrite existing is set to false.`))
    } else {
      if (this.options.options.verbose) {
        this.console!.log(colors.green(`Writing to ${filePath}`))
        this.console!.log(colors.yellow(contents))
      }
      const dir = dirname(filePath)
      ensureDirSync(dir)
      writeFileSync(filePath, contents, 'utf8')
      this.filesEmitted.push(filePath)
    }
  }
}
