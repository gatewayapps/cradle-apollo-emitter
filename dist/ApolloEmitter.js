"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const PropertyType_1 = __importDefault(require("@gatewayapps/cradle/dist/lib/PropertyTypes/PropertyType"));
const fs_1 = require("fs");
const fs_extra_1 = require("fs-extra");
const lodash_1 = __importDefault(require("lodash"));
const path_1 = __importStar(require("path"));
const pluralize_1 = __importDefault(require("pluralize"));
class ApolloModel {
    constructor(schema, resolvers, model) {
        this.Schema = schema;
        this.Resolvers = resolvers;
        this.Model = model;
    }
}
class ApolloEmitter {
    constructor() {
        this.Models = [];
        this.filesEmitted = [];
    }
    prepareEmitter(options, console) {
        return __awaiter(this, void 0, void 0, function* () {
            this.console = console;
            this.options = options;
        });
    }
    emitSchema(schema) {
        return __awaiter(this, void 0, void 0, function* () {
            schema.Models.forEach((model) => {
                const apolloSchema = this.getSchemaForModel(model);
                const apolloResolvers = this.getResolversForModel(model);
                this.Models.push(new ApolloModel(apolloSchema, apolloResolvers, model));
            });
            if (this.options.options.modelOutputPath) {
                this.emitToMultipleFiles();
            }
            else {
                this.emitToSingleFile();
            }
            // actually emit the files
            if (this.options.options.onComplete !== undefined) {
                this.options.options.onComplete(this.filesEmitted);
            }
        });
    }
    getResolversForModel(model) {
        const resolvers = {};
        if (this.options.options.getResolverForReference) {
            const referenceNames = model.References ? Object.keys(model.References) : [];
            referenceNames.forEach((rn) => {
                resolvers[rn] = this.options.options.getResolverForReference(model, rn, model.References[rn]);
                if (!resolvers[rn]) {
                    throw new Error(`${model.Name}.${rn} does not define a resolver.  All references must define a resolver`);
                }
                else {
                    resolvers[rn] = resolvers[rn].toString();
                }
            });
        }
        return resolvers;
    }
    getSchemaForModel(model) {
        const localFields = [];
        const fieldNames = Object.keys(model.Properties);
        const referenceNames = model.References ? Object.keys(model.References) : [];
        fieldNames.forEach((fn) => {
            localFields.push(`\t\t${fn}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fn])}`);
        });
        referenceNames.forEach((rn) => {
            localFields.push(`\t\t${rn}: ${model.References[rn].ForeignModel}`);
        });
        return `
  type ${model.Name} {
${localFields.join('\n')}
  }
`;
    }
    getGraphqlTypeFromPropertyType(propertyType) {
        const requiredToken = propertyType instanceof PropertyType_1.default && propertyType.AllowNull ? '' : '!';
        const propertyTypeName = typeof propertyType === 'string' ? propertyType : propertyType.TypeName;
        switch (propertyTypeName) {
            case 'Object': {
                throw new Error('Object types are not supported in cradle-apollo-emitter');
            }
            case 'Array': {
                const arrayProp = propertyType;
                return `[${this.getGraphqlTypeFromPropertyType(arrayProp.MemberType).replace('!', '')}]`;
            }
            case 'ModelReference': {
                const modelProp = propertyType;
                if (modelProp.ModelType.TypeName === 'Array') {
                    return `[${modelProp.ModelName}]`;
                }
                else {
                    return `${modelProp.ModelName}${requiredToken}`;
                }
            }
            case 'Binary':
                return `String${requiredToken}`;
            case 'Boolean':
                return `Boolean${requiredToken}`;
            case 'DateTime':
                return `Date${requiredToken}`;
            case 'Decimal':
                return `Float${requiredToken}`;
            case 'Integer':
                return `Int${requiredToken}`;
            case 'String':
                return `String${requiredToken}`;
            case 'UniqueIdentifier':
                return `ID${requiredToken}`;
            default:
                throw new Error(`Property type not supported in cradle-apollo-emitter: ${propertyTypeName}`);
        }
    }
    /**
     * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
     * this method does nothing
     * @param contents contents of file to write
     * @param path path to file
     */
    writeContentsToFile(contents, filePath) {
        if (fs_1.existsSync(filePath) && !this.options.options.overwriteExisting) {
            this.console.warn(`${filePath} already exists.  Skipping.`);
        }
        else {
            console.log(`Writing file: ${filePath}`);
            const dir = path_1.dirname(filePath);
            fs_extra_1.ensureDirSync(dir);
            fs_1.writeFileSync(filePath, contents, 'utf8');
            this.filesEmitted.push(filePath);
        }
    }
    emitToMultipleFiles() {
        const models = [];
        this.Models.forEach((m) => {
            const resolverNames = Object.keys(m.Resolvers);
            const imports = this.options.options.getImportsForModel(m.Model);
            const schemaPart = `export const typeDef = \`${m.Schema}\``;
            const isTopLevel = this.options.options.isModelToplevel(m.Model);
            const resolverPart = isTopLevel
                ? `
      export const resolvers = {
        ${m.Model.Name}: {
          ${resolverNames.map((rn) => `    ${rn}: ${m.Resolvers[rn].toString()}`).join(',\n')}
        }
      }`
                : '';
            const fileContents = `
${imports.join('\n')}
${schemaPart}

${resolverPart}
      `;
            const modelFilename = this.options.options.modelOutputPath(m.Model.Name);
            models.push({ modelName: m.Model.Name, filePath: modelFilename, topLevel: isTopLevel });
            this.writeContentsToFile(fileContents, modelFilename);
        });
        const rootQuery = this.getRootQuery();
        const rootResolvers = this.getRootResolvers();
        const allResolvers = [];
        const importStatements = models.map((m) => {
            const parts = [];
            parts.push(`typeDef as ${m.modelName}`);
            if (m.topLevel) {
                allResolvers.push(`${lodash_1.default.camelCase(m.modelName)}Resolvers`);
                parts.push(`resolvers as ${lodash_1.default.camelCase(m.modelName)}Resolvers`);
            }
            const relativePath = path_1.default.relative(path_1.dirname(this.options.options.outputPath), m.filePath).replace(/\\/g, '/') + '/';
            const relativeParts = relativePath.split('.');
            relativeParts.splice(relativeParts.length - 1, 1);
            const finalName = relativeParts.join('.');
            return `import {${parts.join(', ')}} from './${finalName}'`;
        });
        importStatements.push(`import { GraphQLScalarType } from 'graphql'`);
        importStatements.push(`import { Kind } from 'graphql/language'`);
        importStatements.push(`import { merge } from 'lodash'`);
        importStatements.push(`import { makeExecutableSchema } from 'apollo-server'`);
        const rootImports = this.getRootImports();
        importStatements.push(...rootImports);
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

`;
        this.writeContentsToFile(rootFileContents, this.options.options.outputPath);
    }
    getRootQuery() {
        const rootQueries = [];
        this.Models.forEach((m) => {
            if (this.options.options.isModelToplevel(m.Model)) {
                rootQueries.push(`${pluralize_1.default(lodash_1.default.camelCase(m.Model.Name))}(offset: Int, limit: Int): [${m.Model.Name}]`);
                rootQueries.push(`${lodash_1.default.camelCase(m.Model.Name)}(id: ID!): ${m.Model.Name}`);
            }
        });
        return `
type Query {
  ${rootQueries.join('\n\t')}
}
    `;
    }
    getRootImports() {
        const topLevelModels = this.Models.filter((model) => this.options.options.isModelToplevel(model.Model)).map((model) => model.Model);
        return this.options.options.getRootImports(topLevelModels);
    }
    getRootResolvers() {
        const rootResolvers = [];
        this.Models.forEach((m) => {
            if (this.options.options.isModelToplevel(m.Model)) {
                const singleResolver = this.options.options.getResolverForModel(m.Model, 'Single');
                const paginatedResolver = this.options.options.getResolverForModel(m.Model, 'Paginated');
                rootResolvers.push(`${pluralize_1.default(lodash_1.default.camelCase(m.Model.Name))}: ${paginatedResolver.toString()}`);
                rootResolvers.push(`${lodash_1.default.camelCase(m.Model.Name)}: ${singleResolver.toString()}`);
            }
        });
        return rootResolvers.join(',\n');
    }
    emitToSingleFile() {
        const allTypes = this.Models.map((m) => m.Schema).join('\n\n');
    }
}
exports.default = ApolloEmitter;
//# sourceMappingURL=ApolloEmitter.js.map