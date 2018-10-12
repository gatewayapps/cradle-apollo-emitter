import { CradleModel, CradleSchema, EmitterOptions, IConsole, ICradleEmitter } from '@gatewayapps/cradle'
import ArrayPropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ArrayPropertyType'
import ModelReferenceType from '@gatewayapps/cradle/dist/lib/PropertyTypes/ModelReferenceType'
import PropertyType from '@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType'
import colors from 'colors'
import { existsSync, writeFileSync } from 'fs'
import { ensureDirSync, writeFile } from 'fs-extra'
import _ from 'lodash'
import path, { dirname, extname } from 'path'
import pluralize from 'pluralize'
import { IApolloEmitterOptions } from './IApolloEmitterOptions'

class ApolloModel {
  public Schema: string
  public Resolvers: Record<string, string>
  public Model: CradleModel

  constructor(schema: string, resolvers: Record<string, string>, model: CradleModel) {
    this.Schema = schema
    this.Resolvers = resolvers
    this.Model = model
  }
}

export default class ApolloEmitter implements ICradleEmitter {
  public console?: IConsole
  public options!: EmitterOptions<IApolloEmitterOptions>
  private Models: ApolloModel[] = []
  private filesEmitted: string[] = []
  public async prepareEmitter(options: EmitterOptions<IApolloEmitterOptions>, console: IConsole) {
    this.console = console
    this.options = options
  }

  public async emitSchema(schema: CradleSchema) {
    schema.Models.forEach((model) => {
      const apolloSchema = this.getSchemaForModel(model)
      const apolloResolvers = this.getResolversForModel(model)

      this.Models.push(new ApolloModel(apolloSchema, apolloResolvers, model))
    })
    if (this.options.options.modelOutputPath) {
      this.emitToMultipleFiles()
    } else {
      this.emitToSingleFile()
    }
    // actually emit the files

    if (this.options.options.onComplete !== undefined) {
      this.options.options.onComplete(this.filesEmitted)
    }
  }

  public getResolversForModel(model: CradleModel): Record<string, string> {
    const resolvers: Record<string, string> = {}
    if (this.options.options.getResolverForReference) {
      const referenceNames = model.References ? Object.keys(model.References) : []
      referenceNames.forEach((rn) => {
        resolvers[rn] = this.options.options.getResolverForReference!(model, rn, model.References[rn])
        if (!resolvers[rn]) {
          throw new Error(`${model.Name}.${rn} does not define a resolver.  All references must define a resolver`)
        } else {
          resolvers[rn] = resolvers[rn].toString()
        }
      })
    }
    return resolvers
  }

  public getSchemaForModel(model: CradleModel): string {
    const localFields: string[] = []

    const fieldNames = Object.keys(model.Properties)
    const referenceNames = model.References ? Object.keys(model.References) : []

    fieldNames.forEach((fn) => {
      localFields.push(`\t\t${fn}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fn])}`)
    })
    referenceNames.forEach((rn) => {
      localFields.push(`\t\t${rn}: ${model.References[rn]!.ForeignModel}`)
    })

    return `
  type ${model.Name} {
${localFields.join('\n')}
  }
`
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

  /**
   * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
   * this method does nothing
   * @param contents contents of file to write
   * @param path path to file
   */
  private writeContentsToFile(contents: string, filePath: string) {
    if (existsSync(filePath) && !this.options.options.overwriteExisting) {
      this.console!.warn(`${filePath} already exists.  Skipping.`)
    } else {
      console.log(`Writing file: ${filePath}`)
      const dir = dirname(filePath)
      ensureDirSync(dir)
      writeFileSync(filePath, contents, 'utf8')
      this.filesEmitted.push(filePath)
    }
  }

  private emitToMultipleFiles() {
    const models: Array<{ modelName: string; filePath: string; topLevel: boolean }> = []

    this.Models.forEach((m) => {
      const resolverNames = Object.keys(m.Resolvers)
      const imports = this.options.options.getImportsForModel!(m.Model)
      const schemaPart = `export const typeDef = \`${m.Schema}\``
      const isTopLevel = this.options.options.isModelToplevel!(m.Model)
      const resolverPart = isTopLevel
        ? `
      export const resolvers = {
        ${m.Model.Name}: {
          ${resolverNames.map((rn) => `    ${rn}: ${m.Resolvers[rn].toString()}`).join(',\n')}
        }
      }`
        : ''

      const fileContents = `
${imports.join('\n')}
${schemaPart}

${resolverPart}
      `

      const modelFilename = this.options.options.modelOutputPath!(m.Model.Name)
      models.push({ modelName: m.Model.Name, filePath: modelFilename, topLevel: isTopLevel })
      this.writeContentsToFile(fileContents, modelFilename)
    })

    const rootQuery = this.getRootQuery()
    const rootResolvers = this.getRootResolvers()
    const allResolvers: string[] = []
    const importStatements = models.map((m) => {
      const parts: string[] = []
      parts.push(`typeDef as ${m.modelName}`)
      if (m.topLevel) {
        allResolvers.push(`${_.camelCase(m.modelName)}Resolvers`)
        parts.push(`resolvers as ${_.camelCase(m.modelName)}Resolvers`)
      }

      const relativePath = path.relative(dirname(this.options.options.outputPath), m.filePath).replace(/\\/g, '/') + '/'
      const relativeParts = relativePath.split('.')
      relativeParts.splice(relativeParts.length - 1, 1)
      const finalName = relativeParts.join('.')

      return `import {${parts.join(', ')}} from './${finalName}'`
    })
    importStatements.push(`import { GraphQLScalarType } from 'graphql'`)
    importStatements.push(`import { Kind } from 'graphql/language'`)
    importStatements.push(`import { merge } from 'lodash'`)
    importStatements.push(`import { makeExecutableSchema } from 'apollo-server'`)

    const rootImports = this.getRootImports()

    importStatements.push(...rootImports)

    const rootFileContents = `
${importStatements.join('\n')}

const Query = \`

scalar Date

${rootQuery}\`

const resolvers = {
  Date: new GraphQLScalarType({
    name: 'Date',
    description: 'Date custom scalar type',
    parseValue(value) {
      return new Date(value) // value from the client
    },
    serialize(value) {
      return value.getTime() // value sent to the client
    },
    parseLiteral(ast) {
      if (ast.kind === Kind.INT) {
        return new Date(ast.value) // ast value is always in string format
      }
      return null
    }
  }),
  Query: {
${rootResolvers}
  }
}

export const schema = makeExecutableSchema({
  typeDefs: [ Query, ${models.map((m) => m.modelName).join(', ')} ],
  resolvers: merge(resolvers, ${allResolvers.join(', ')})
})

`
    this.writeContentsToFile(rootFileContents, this.options.options.outputPath)
  }

  private getRootQuery(): string {
    const rootQueries: string[] = []
    this.Models.forEach((m) => {
      if (this.options.options.isModelToplevel!(m.Model)) {
        rootQueries.push(`${pluralize(_.camelCase(m.Model.Name))}(offset: Int, limit: Int): [${m.Model.Name}]`)
        rootQueries.push(`${_.camelCase(m.Model.Name)}(id: ID!): ${m.Model.Name}`)
      }
    })
    return `
type Query {
  ${rootQueries.join('\n\t')}
}
    `
  }

  private getRootImports(): string[] {
    const topLevelModels = this.Models.filter((model) => this.options.options.isModelToplevel!(model.Model)).map((model) => model.Model)
    return this.options.options.getRootImports(topLevelModels)
  }

  private getRootResolvers(): string {
    const rootResolvers: string[] = []
    this.Models.forEach((m) => {
      if (this.options.options.isModelToplevel!(m.Model)) {
        const singleResolver = this.options.options.getResolverForModel(m.Model, 'Single')
        const paginatedResolver = this.options.options.getResolverForModel(m.Model, 'Paginated')
        rootResolvers.push(`${pluralize(_.camelCase(m.Model.Name))}: ${paginatedResolver.toString()}`)
        rootResolvers.push(`${_.camelCase(m.Model.Name)}: ${singleResolver.toString()}`)
      }
    })
    return rootResolvers.join(',\n')
  }

  private emitToSingleFile() {
    const allTypes = this.Models.map((m) => m.Schema).join('\n\n')
  }
}
