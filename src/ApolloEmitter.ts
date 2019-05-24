import { CradleModel, CradleSchema, EmitterOptions, IConsole, ICradleEmitter, ICradleOperation } from '@gatewayapps/cradle'

import ArrayPropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ArrayPropertyType'

import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType'
import ReferenceModelType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ReferenceModelType'
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
  public options!: IApolloEmitterOptions

  public getOperation
  private Models: ApolloModel[] = []
  private filesEmitted: string[] = []
  constructor(options: IApolloEmitterOptions, console: IConsole) {
    this.console = console
    this.options = options
  }

  public async emitSchema(schema: CradleSchema) {
    schema.Models.forEach((model) => {
      if (this.shouldEmitModel(model)) {
        this.writeTypeDefsForModel(model)

        if (this.shouldGenerateResolvers(model) && this.options.shouldOutputResolverFiles !== false) {
          this.writeResolversForModel(model)
        }
      }
    })

    // write index.ts file for schema.

    if (this.options.onComplete !== undefined) {
      if (this.options.verbose) {
        this.console!.log(`Calling onComplete with [ ${this.filesEmitted.join(', ') || 'Empty Array'} ]`)
      }
      this.options.onComplete(this.filesEmitted)
    }
  }

  public getMutationDefsForModel(model: CradleModel): string {
    const operationNames = Object.keys(model.Operations)
    const mutationDefs: string[] = []

    operationNames.forEach((opName) => {
      const operationArgs = this.getArgsTypeNameForOperation(opName)
      const directive = this.getDirectiveForResolver(model, 'mutation', opName)
      const returnType = this.getGraphqlTypeFromPropertyType(model.Operations[opName]!.Returns).replace('!', '')
      mutationDefs.push(`\t${opName}(data: ${operationArgs}!): ${returnType} ${directive}`)
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

    const queryDirective = this.getDirectiveForResolver(model, 'query', pluralQueryName)
    const metaDirective = this.getDirectiveForResolver(model, 'query', `${pluralQueryName}Meta`)
    const singularDirective = this.getDirectiveForResolver(model, 'query', singularQueryNameBase)

    return `
${collectionTypeDef}

${filterTypeDefs}

type Query {
\t${pluralQueryName}(offset: Int, limit: Int, filter: ${model.Name}Filter): [${model.Name}!]! ${queryDirective}
\t${pluralQueryName}Meta(filter: ${model.Name}Filter): ${model.Name}Meta! ${metaDirective}
\t${singularQueryNameBase}(where: ${model.Name}UniqueFilter): ${model.Name} ${singularDirective}
}`
  }

  public getTypeDefsForModel(model: CradleModel): string {
    const localFields: string[] = []
    const fieldNames = Object.keys(model.Properties)
    // const referenceNames = model.References ? Object.keys(model.References) : []

    this.getIncludedPropertiesNames(model).forEach((fn) => {
      localFields.push(`\t${fn}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fn])}`)
    })
    // this.getIncludedReferencesNames(model).forEach((rn) => {
    //   const referenceName = model.References[rn]!.RelationType === 2 ? `[${model.References[rn]!.ForeignModel}]` : model.References[rn]!.ForeignModel
    //   localFields.push(`\t${rn}: ${referenceName}`)
    // })

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
      const gqlType = this.getGraphqlTypeFromPropertyType(prop, true)
      localFields.push(`\t${fn}: ${gqlType}`)
    })

    const argsTypeName = this.getArgsTypeNameForOperation(operationName)
    return `input ${argsTypeName} {
${localFields.join('\n')}
}`
  }

  public getGraphqlTypeFromPropertyType(propertyType: PropertyType | string, forInput: boolean = false) {
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
        const finalType = this.getGraphqlTypeFromPropertyType(arrayProp.MemberType).replace('!', '')

        const inputToken = forInput && !this.isBaseType(finalType) ? 'Input' : ''
        return `[${finalType}${inputToken}!]${requiredToken}`
      }
      case 'ReferenceModel': {
        const modelProp = propertyType as ReferenceModelType
        const inputToken = forInput ? 'Input' : ''
        return `${modelProp.ModelName}${inputToken}${requiredToken}`
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
        if (this.options.useMongoObjectIds) {
          return `ObjectID${requiredToken}`
        } else {
          return `ID${requiredToken}`
        }
      }

      default:
        throw new Error(`Property type not supported in cradle-apollo-emitter: ${propertyTypeName}`)
    }
  }

  private shouldEmitModel(model: CradleModel): boolean {
    if (this.options.shouldEmitModel) {
      return this.options.shouldEmitModel(model)
    } else if (this.options.isModelToplevel) {
      return this.options.isModelToplevel(model)
    }
    return true
  }

  private getDirectiveForResolver(model: CradleModel, resolverType: string, resolverName: string): string {
    if (!this.options.getDirectiveForResolver) {
      return ''
    }
    return this.options.getDirectiveForResolver(model, resolverType, resolverName)
  }

  private isBaseType(typeName: string) {
    switch (typeName) {
      case 'String':
      case 'Boolean':
      case 'Binary':
      case 'DateTime':
      case 'Integer':
      case 'UniqueIdentifier':
      case 'Decimal': {
        return true
      }
      default: {
        if (typeName === 'ObjectID' && this.options.useMongoObjectIds) {
          return true
        }
        return false
      }
    }
  }

  private generateUniqueFilterInputType(model: CradleModel): string {
    const propNames = this.getIdentifiersForModel(model)
    const resultParts: string[] = []
    propNames.forEach((pn) => {
      const prop: PropertyType = model.Properties[pn]
      const gqlType = this.getGraphqlTypeFromPropertyType(prop.TypeName)
      resultParts.push(`\t${pn}: ${gqlType.replace('!', '')}`)
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
    const resultParts: string[] = []
    this.getIncludedPropertiesNames(model).forEach((pn) => {
      const prop: PropertyType = model.Properties[pn]
      if (prop && prop.TypeName && ['DateTime', 'Decimal', 'Integer', 'String', 'Boolean', 'UniqueIdentifier'].includes(prop.TypeName)) {
        const gqlType = this.getGraphqlTypeFromPropertyType(prop.TypeName).replace('!', '')

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
            resultParts.push(`\t${pn}_notContains: ${gqlType}`)
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

    const outputFilename = this.options.outputType === 'typescript' ? 'resolvers.ts' : 'resolvers.js'

    const modelResolverFilePath = path.join(this.options.outputDirectory, model.Name, outputFilename)
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

    // if (model.References) {
    //   const referenceNames = Object.keys(model.References)
    //   referenceNames.forEach((refName) => {
    //     references.push(this.getStubMethodFor(refName))
    //   })
    // }

    const exportClause = this.options.outputType === 'typescript' ? 'export default' : 'module.exports ='

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
    return !this.options.shouldGenerateResolvers || this.options.shouldGenerateResolvers(model)
  }

  private writeTypeDefsForModel(model: CradleModel) {
    const modelTypeDefs = this.getTypeDefsForModel(model)

    const modelQueries = this.shouldGenerateResolvers(model) && this.getQueryDefsForModel(model)

    const modelMutations = this.shouldGenerateResolvers(model) && this.getMutationDefsForModel(model)

    const apolloSchema = _.compact([modelTypeDefs, modelQueries, modelMutations]).join('\n\n')

    const typeDefsPath = join(this.options.outputDirectory, model.Name, 'typedefs.graphql')

    this.writeContentsToFile(apolloSchema, typeDefsPath)
  }

  private getIncludedPropertiesNames(model: CradleModel): string[] {
    const fieldNames = Object.keys(model.Properties)
    if (this.options.shouldTypeIncludeProperty) {
      const filterFunc = this.options.shouldTypeIncludeProperty
      return fieldNames.filter((name) => filterFunc(model, name, model.Properties[name]))
    }
    return fieldNames
  }

  // private getIncludedReferencesNames(model: CradleModel): string[] {
  //   const referenceNames = model.References ? Object.keys(model.References) : []
  //   if (this.options.shouldTypeIncludeReference) {
  //     const filterFunc = this.options.shouldTypeIncludeReference
  //     return referenceNames.filter((name) => filterFunc(model, name, model.References[name]))
  //   }

  //   return referenceNames
  // }

  private getIdentifiersForModel(model: CradleModel): string[] {
    return this.getIncludedPropertiesNames(model).filter((fn) => {
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
    if (existsSync(filePath) && !this.options.overwriteExisting) {
      this.console!.warn(colors.gray(`Not writing ${filePath} as it already exists and overwrite existing is set to false.`))
    } else {
      if (this.options.verbose) {
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
