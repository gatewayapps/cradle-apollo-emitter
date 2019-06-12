import {
  ArrayPropertyType,
  CradleModel,
  CradleSchema,
  IConsole,
  ICradleOperation,
  ImportModelType,
  PropertyType,
  ReferenceModelType
} from '@gatewayapps/cradle'
import { FileEmitter, FileEmitterOptionsArgs } from '@gatewayapps/cradle-file-emitter'

import _ from 'lodash'

import pluralize from 'pluralize'

class ApolloModel {
  public Schema: string
  public Model: CradleModel

  constructor(schema: string, model: CradleModel) {
    this.Schema = schema
    this.Model = model
  }
}

export default class ApolloEmitter extends FileEmitter {
  public getOperation
  private Models: ApolloModel[] = []
  private filesEmitted: string[] = []
  constructor(options: FileEmitterOptionsArgs, output: string, console: IConsole) {
    super(options, output, console)
    if (options.formatting === 'prettier') {
      const prettierConfig = options.prettierConfig || {}
      prettierConfig.parser = 'graphql'
      options.prettierConfig = prettierConfig
    }
    this.options = options
  }
  public async getContentsForModel(model: CradleModel): Promise<string> {
    const modelTypeDefs = this.getTypeDefsForModel(model)

    const modelQueries = this.getQueryDefsForModel(model)

    const modelMutations = this.getMutationDefsForModel(model)

    const apolloSchema = _.compact([modelTypeDefs, modelQueries, modelMutations]).join('\n\n')

    return apolloSchema
  }
  public async mergeFileContents(modelFileContents: any[]): Promise<string> {
    const generalOutput: string[] = []
    const queryOutput: string[] = []
    const mutationOutput: string[] = []

    for (const mfc of modelFileContents) {
      const contentParts: string[] = mfc.contents.split('\n')
      let inQuery = false
      let inMutation = false

      for (const line of contentParts) {
        if (line.includes('type Query {')) {
          inQuery = true
          continue
        }
        if (line.includes('type Mutation {')) {
          inMutation = true
          continue
        }
        if ((inQuery || inMutation) && line.includes('}')) {
          inQuery = false
          inMutation = false
          continue
        }

        if (inQuery) {
          queryOutput.push(line)
        }
        if (inMutation) {
          mutationOutput.push(line)
        }
        if (!inQuery && !inMutation) {
          generalOutput.push(line)
        }
      }
    }

    const mutationClause =
      mutationOutput.length > 0
        ? `type Mutation {
      ${mutationOutput.join('\n')}
}`
        : ''

    const queryClause =
      queryOutput.length > 0
        ? `type Query {
  ${queryOutput.join('\n')}
}`
        : ''

    return `
scalar Date

${queryClause}

${mutationClause}

${generalOutput.join('\n')}
    `
  }

  public getMutationDefsForModel(model: CradleModel): string {
    const operationNames = Object.keys(model.Operations)
    const mutationDefs: string[] = []

    operationNames.forEach((opName) => {
      const operationArgs = this.getArgsTypeNameForOperation(opName)
      const returnType = this.getGraphqlTypeFromPropertyType(model.Operations[opName]!.Returns).replace('!', '')
      mutationDefs.push(`\t${opName}(data: ${operationArgs}!): ${returnType}`)
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
\t${pluralQueryName}Meta(filter: ${model.Name}Filter): ${model.Name}Meta!
\t${singularQueryNameBase}(where: ${model.Name}UniqueFilter): ${model.Name}
}`
  }

  public getTypeDefsForModel(model: CradleModel): string {
    const localFields: string[] = []
    const fieldNames = Object.keys(model.Properties)
    // const referenceNames = model.References ? Object.keys(model.References) : []

    fieldNames.forEach((fn) => {
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
      case 'ImportModel': {
        const modelProp = propertyType as ImportModelType
        const inputToken = forInput ? 'Input' : ''
        return `${modelProp.ModelName}${inputToken}${requiredToken}`
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
        return `ID${requiredToken}`
      }

      default:
        throw new Error(`Property type not supported in cradle-apollo-emitter: ${propertyTypeName}`)
    }
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
    const propertyNames = Object.keys(model.Properties)
    propertyNames.forEach((pn) => {
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

  // private getIncludedReferencesNames(model: CradleModel): string[] {
  //   const referenceNames = model.References ? Object.keys(model.References) : []
  //   if (this.options.shouldTypeIncludeReference) {
  //     const filterFunc = this.options.shouldTypeIncludeReference
  //     return referenceNames.filter((name) => filterFunc(model, name, model.References[name]))
  //   }

  //   return referenceNames
  // }

  private getIdentifiersForModel(model: CradleModel): string[] {
    const propNames = Object.keys(model.Properties)
    return propNames.filter((propName) => {
      const field = model.Properties[propName]
      return field && (field.IsPrimaryKey || field.Unique || field.TypeName === 'UniqueIdentifier') && !field.AllowNull
    })
  }

  private getArgsTypeNameForOperation(operationName: string): string {
    return `${_.startCase(operationName).replace(/\s/g, '')}Args`
  }
}
