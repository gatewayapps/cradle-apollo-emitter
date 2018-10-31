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
    schema.Models.forEach((model) => {
      if (!this.options.options.isModelToplevel || this.options.options.isModelToplevel(model)) {
        this.writeTypeDefsForModel(model)

        if (this.shouldGenerateResolvers(model) && this.options.options.shouldOutputResolverFiles !== false) {
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

    const filterParts: string[] = []
    filterParts.push(this.generateFilterInputType(model))
    filterParts.push(this.generateUniqueFilterInputType(model))
    const filterTypeDefs = filterParts.join('\n\n')

    const collectionTypeDef = `type ${model.Name}Meta {
\tcount: Int!
}`

    return `
${collectionTypeDef}

${filterTypeDefs}

type Query {
\t${pluralQueryName}(offset: Int, limit: Int, filter: ${model.Name}Filter): [${model.Name}!]!
\t${pluralQueryName}Meta(filter: ${model.Name}Filter): ${model.Name}Meta
\t${singularQueryNameBase}(where: ${model.Name}UniqueFilter): ${model.Name}
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
        const referenceName =
          model.References[rn]!.RelationType === 2 ? `[${model.References[rn]!.ForeignModel}]` : model.References[rn]!.ForeignModel
        localFields.push(`\t${rn}: ${referenceName}`)
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
      const prop = operation.Arguments[fn]
      const gqlType = this.getGraphqlTypeFromPropertyType(prop)
      localFields.push(`\t${fn}: ${gqlType}`)
    })

    const argsTypeName = this.getArgsTypeNameForOperation(operationName)
    return `input ${argsTypeName} {
${localFields.join('\n')}
}`
  }

  public getGraphqlTypeFromPropertyType(propertyType: PropertyType | string) {
    let requiredToken = ''
    if (typeof propertyType === 'object' && !propertyType.AllowNull) {
      requiredToken = '!'
    } else if (typeof propertyType === 'string') {
      if (propertyType.indexOf('?') === -1) {
        requiredToken = '!'
      }
    }

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
      case 'UniqueIdentifier': {
        if (this.options.options.useMongoObjectIds) {
          return `ObjectID${requiredToken}`
        } else {
          return `ID${requiredToken}`
        }
      }

      default:
        throw new Error(`Property type not supported in cradle-apollo-emitter: ${propertyTypeName}`)
    }
  }

  private generateUniqueFilterInputType(model: CradleModel): string {
    const propNames = this.getIdentifiersForModel(model)
    const resultParts: string[] = []
    propNames.forEach((pn) => {
      const prop: PropertyType = model.Properties[pn]
      const gqlType = this.getGraphqlTypeFromPropertyType(prop.TypeName)
      resultParts.push(`\t${pn}: ${gqlType}`)
    })
    if (resultParts.length > 0) {
      return `input ${model.Name}UniqueFilter {
${resultParts.join('\n')}
}`
    } else {
      return ''
    }
  }

  private generateFilterInputType(model: CradleModel): string {
    const propNames = Object.keys(model.Properties)
    const resultParts: string[] = []
    propNames.forEach((pn) => {
      const prop: PropertyType = model.Properties[pn]
      if (prop && prop.TypeName && ['DateTime', 'Decimal', 'Integer', 'String', 'Boolean', 'UniqueIdentifier'].find((x) => x === prop.TypeName)) {
        const gqlType = `${this.getGraphqlTypeFromPropertyType(prop.TypeName)}`

        switch (prop.TypeName) {
          case 'DateTime':
          case 'Decimal':
          case 'Integer': {
            resultParts.push(`\t${pn}_lessThan: ${gqlType}`)
            resultParts.push(`\t${pn}_greaterThan: ${gqlType}`)
            resultParts.push(`\t${pn}_equals: ${gqlType}`)
            resultParts.push(`\t${pn}_notEquals: ${gqlType}`)
            return
          }
          case 'String': {
            resultParts.push(`\t${pn}_contains: ${gqlType}`)
            resultParts.push(`\t${pn}_startsWith: ${gqlType}`)
            resultParts.push(`\t${pn}_endsWith: ${gqlType}`)
            resultParts.push(`\t${pn}_equals: ${gqlType}`)
            resultParts.push(`\t${pn}_notEquals: ${gqlType}`)
            return
          }
          case 'Boolean': {
            resultParts.push(`\t${pn}_equals: ${gqlType}`)
            resultParts.push(`\t${pn}_notEquals: ${gqlType}`)
            return
          }
          case 'UniqueIdentifier': {
            resultParts.push(`\t${pn}_in: [${gqlType}]`)
            resultParts.push(`\t${pn}_equals: ${gqlType}`)
            resultParts.push(`\t${pn}_notEquals: ${gqlType}`)
            return
          }
        }
      }
    })
    if (resultParts.length > 0) {
      return `input ${model.Name}Filter {
  or: [${model.Name}Filter!]
  and: [${model.Name}Filter!]
${resultParts.join('\n')}
}`
    } else {
      return ''
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
    const queries: string[] = [pluralQueryName, `${pluralQueryName}Meta`, singularQueryNameBase]
    const mutations: string[] = []
    const references: string[] = []

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

  private shouldGenerateResolvers(model: CradleModel) {
    return !this.options.options.shouldGenerateResolvers || this.options.options.shouldGenerateResolvers(model)
  }

  private writeTypeDefsForModel(model: CradleModel) {
    const modelTypeDefs = this.getTypeDefsForModel(model)

    const modelQueries = this.shouldGenerateResolvers(model) && this.getQueryDefsForModel(model)

    const modelMutations = this.shouldGenerateResolvers(model) && this.getMutationDefsForModel(model)

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
