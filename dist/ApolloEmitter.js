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
const colors_1 = __importDefault(require("colors"));
const fs_1 = require("fs");
const fs_extra_1 = require("fs-extra");
const lodash_1 = __importDefault(require("lodash"));
const path_1 = __importStar(require("path"));
const pluralize_1 = __importDefault(require("pluralize"));
class ApolloModel {
    constructor(schema, model) {
        this.Schema = schema;
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
                if (!this.options.options.isModelToplevel || this.options.options.isModelToplevel(model)) {
                    this.writeTypeDefsForModel(model);
                    this.writeResolversForModel(model);
                }
            });
            // write index.ts file for schema.
            if (this.options.options.onComplete !== undefined) {
                if (this.options.options.verbose) {
                    this.console.log(`Calling onComplete with [ ${this.filesEmitted.join(', ') || 'Empty Array'} ]`);
                }
                this.options.options.onComplete(this.filesEmitted);
            }
        });
    }
    getMutationDefsForModel(model) {
        const operationNames = Object.keys(model.Operations);
        const mutationDefs = [];
        operationNames.forEach((opName) => {
            const operationArgs = this.getArgsTypeNameForOperation(opName);
            mutationDefs.push(`\t${opName}(data: ${operationArgs}!): ${this.getGraphqlTypeFromPropertyType(model.Operations[opName].Returns).replace('!', '')}`);
        });
        if (mutationDefs.length > 0) {
            return `type Mutation {
${mutationDefs.join('\n')}
}`;
        }
        else {
            return '';
        }
    }
    getQueryDefsForModel(model) {
        const singularQueryNameBase = lodash_1.default.camelCase(pluralize_1.default(model.Name, 1));
        const pluralQueryName = lodash_1.default.camelCase(pluralize_1.default(model.Name, 2));
        const singularQueries = [];
        const identifiers = this.getIdentifiersForModel(model);
        identifiers.forEach((fieldName) => {
            const queryName = `${singularQueryNameBase}By${lodash_1.default.startCase(fieldName).replace(/\s/g, '')}`;
            singularQueries.push(`\t${queryName}(${lodash_1.default.camelCase(fieldName)}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fieldName])}): ${model.Name}`);
        });
        return `type Query {
\t${pluralQueryName}(offset: Int, limit: Int): [${model.Name}]
${singularQueries.join('\n')}
}`;
    }
    getTypeDefsForModel(model) {
        const localFields = [];
        const fieldNames = Object.keys(model.Properties);
        const referenceNames = model.References ? Object.keys(model.References) : [];
        fieldNames.forEach((fn) => {
            if (!this.options.options.shouldTypeIncludeProperty || this.options.options.shouldTypeIncludeProperty(model, fn, model.Properties[fn])) {
                localFields.push(`\t${fn}: ${this.getGraphqlTypeFromPropertyType(model.Properties[fn])}`);
            }
        });
        referenceNames.forEach((rn) => {
            if (!this.options.options.shouldTypeIncludeReference || this.options.options.shouldTypeIncludeReference(model, rn, model.References[rn])) {
                localFields.push(`\t${rn}: ${model.References[rn].ForeignModel}`);
            }
        });
        const typeDefs = [];
        typeDefs.push(`type ${model.Name} {
${localFields.join('\n')}
}`);
        if (model.Operations) {
            const operationNames = Object.keys(model.Operations);
            operationNames.forEach((opName) => {
                const operationArgsTypeDef = this.getSchemaForOperationArgs(opName, model.Operations[opName]);
                typeDefs.push(operationArgsTypeDef);
            });
        }
        return typeDefs.join('\n\n');
    }
    getSchemaForOperationArgs(operationName, operation) {
        const localFields = [];
        const fieldNames = Object.keys(operation.Arguments);
        fieldNames.forEach((fn) => {
            localFields.push(`\t${fn}: ${this.getGraphqlTypeFromPropertyType(operation.Arguments[fn])}`);
        });
        const argsTypeName = this.getArgsTypeNameForOperation(operationName);
        return `input ${argsTypeName} {
${localFields.join('\n')}
}`;
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
    getStubMethodFor(methodName) {
        return `${methodName}: (obj, args, context, info) => {
      // Insert your ${methodName} implementation here
      throw new Error('${methodName} is not implemented')
    }`;
    }
    writeResolversForModel(model) {
        const singularQueryNameBase = lodash_1.default.camelCase(pluralize_1.default(model.Name, 1));
        const pluralQueryName = lodash_1.default.camelCase(pluralize_1.default(model.Name, 2));
        const modelResolverFilePath = path_1.default.join(this.options.options.outputDirectory, model.Name, 'resolvers.ts');
        const queries = [pluralQueryName];
        const mutations = [];
        const references = [];
        const identifiers = this.getIdentifiersForModel(model);
        identifiers.forEach((fieldName) => {
            queries.push(`${singularQueryNameBase}By${lodash_1.default.startCase(fieldName).replace(/\s/g, '')}`);
        });
        queries.forEach((q, qi) => {
            queries[qi] = this.getStubMethodFor(q);
        });
        if (model.Operations) {
            const operationNames = Object.keys(model.Operations);
            operationNames.forEach((opName) => {
                mutations.push(this.getStubMethodFor(opName));
            });
        }
        if (model.References) {
            const referenceNames = Object.keys(model.References);
            referenceNames.forEach((refName) => {
                references.push(this.getStubMethodFor(refName));
            });
        }
        const resolverBody = `export const ${model.Name}Resolvers = {
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
    `;
        this.writeContentsToFile(resolverBody, modelResolverFilePath);
    }
    writeTypeDefsForModel(model) {
        const modelTypeDefs = this.getTypeDefsForModel(model);
        const modelQueries = this.getQueryDefsForModel(model);
        const modelMutations = this.getMutationDefsForModel(model);
        const apolloSchema = [modelTypeDefs, modelQueries, modelMutations].join('\n\n');
        const typeDefsPath = path_1.join(this.options.options.outputDirectory, model.Name, 'typedefs.graphql');
        this.writeContentsToFile(apolloSchema, typeDefsPath);
    }
    getIdentifiersForModel(model) {
        const fieldNames = Object.keys(model.Properties);
        return fieldNames.filter((fn) => {
            const field = model.Properties[fn];
            return field && (field.IsPrimaryKey || field.Unique || field.TypeName === 'UniqueIdentifier') && !field.AllowNull;
        });
    }
    getArgsTypeNameForOperation(operationName) {
        return `${lodash_1.default.startCase(operationName).replace(/\s/g, '')}Args`;
    }
    /**
     * Writes contents to path and adds path to emittedFiles array.  If overwriteExisting is false and the file DOES already exist
     * this method does nothing
     * @param contents contents of file to write
     * @param path path to file
     */
    writeContentsToFile(contents, filePath) {
        if (fs_1.existsSync(filePath) && !this.options.options.overwriteExisting) {
            this.console.warn(colors_1.default.gray(`Not writing ${filePath} as it already exists and overwrite existing is set to false.`));
        }
        else {
            if (this.options.options.verbose) {
                this.console.log(colors_1.default.green(`Writing to ${filePath}`));
                this.console.log(colors_1.default.yellow(contents));
            }
            const dir = path_1.dirname(filePath);
            fs_extra_1.ensureDirSync(dir);
            fs_1.writeFileSync(filePath, contents, 'utf8');
            this.filesEmitted.push(filePath);
        }
    }
}
exports.default = ApolloEmitter;
//# sourceMappingURL=ApolloEmitter.js.map