import { parse } from "acorn";
import type { Node } from "acorn";

import { isPlainRecord, sha256, toJsonValue, type JsonValue, type WorkflowMeta } from "./domain.ts";
import { err, ok, type Result } from "./result.ts";

export const MAX_WORKFLOW_SOURCE_CHARS = 524_288;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parsed workflow script with pure metadata and executable body. */
export interface ParsedWorkflowScript {
  readonly meta: WorkflowMeta;
  readonly body: string;
  readonly sourceHash: string;
}

export class WorkflowParseError extends Error {
  readonly _tag = "WorkflowParseError";
}

/** Parse a workflow script and extract the first-statement meta export. */
export function parseWorkflowScript(source: string): Result<ParsedWorkflowScript, WorkflowParseError> {
  if (source.length > MAX_WORKFLOW_SOURCE_CHARS) {
    return err(new WorkflowParseError(`Workflow source exceeds ${MAX_WORKFLOW_SOURCE_CHARS} characters`));
  }
  const hidden = firstHiddenControl(source);
  if (hidden !== undefined) {
    return err(new WorkflowParseError(`Workflow source contains hidden control character 0x${hidden.toString(16)}`));
  }

  let program: ProgramNode;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    }) as ProgramNode;
  } catch (error) {
    return err(new WorkflowParseError(error instanceof Error ? error.message : String(error)));
  }

  const first = program.body[0];
  if (!first) return err(new WorkflowParseError("Workflow source must start with export const meta = ..."));
  const metaNode = extractMetaNode(first);
  if (!metaNode.ok) return metaNode;

  const metaValue = evaluateMetaLiteral(metaNode.value);
  if (!metaValue.ok) return metaValue;
  const meta = buildMeta(metaValue.value);
  if (!meta.ok) return meta;

  for (const statement of program.body.slice(1)) {
    if (statement.type.startsWith("Import") || statement.type.startsWith("Export")) {
      return err(new WorkflowParseError("Workflow body cannot contain import/export statements"));
    }
  }

  const deterministic = rejectStaticNondeterminism(program);
  if (!deterministic.ok) return deterministic;

  const dsl = rejectStaticDslMisuse(program);
  if (!dsl.ok) return dsl;

  return ok({
    meta: meta.value,
    body: source.slice(first.end).trimStart(),
    sourceHash: sha256(source),
  });
}

/** First hidden control code point, if present. */
export function firstHiddenControl(source: string): number | undefined {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) return code;
  }
  return undefined;
}

function extractMetaNode(node: StatementNode): Result<ExpressionNode, WorkflowParseError> {
  if (node.type !== "ExportNamedDeclaration") {
    return err(new WorkflowParseError("Workflow source must start with export const meta = ..."));
  }
  const declaration = node.declaration;
  if (!declaration || declaration.type !== "VariableDeclaration" || declaration.kind !== "const") {
    return err(new WorkflowParseError("Workflow meta must be exported as const"));
  }
  if (declaration.declarations.length !== 1) {
    return err(new WorkflowParseError("Workflow meta export must declare exactly one binding"));
  }
  const [binding] = declaration.declarations;
  if (!binding || binding.id.type !== "Identifier" || binding.id.name !== "meta" || !binding.init) {
    return err(new WorkflowParseError("Workflow meta export must be named meta and have an initializer"));
  }
  return ok(binding.init);
}

function evaluateMetaLiteral(node: ExpressionNode): Result<JsonValue, WorkflowParseError> {
  switch (node.type) {
    case "Literal": {
      const literal = (node as LiteralNode).value;
      if (literal instanceof RegExp) return err(new WorkflowParseError("meta cannot contain regex literals"));
      const value = toJsonValue(literal);
      return value === undefined ? err(new WorkflowParseError("meta contains a non-JSON literal")) : ok(value);
    }
    case "TemplateLiteral": {
      const template = node as TemplateLiteralNode;
      if (template.expressions.length > 0 || template.quasis.length !== 1) {
        return err(new WorkflowParseError("meta template literals cannot contain interpolation"));
      }
      return ok(template.quasis[0]?.value.cooked ?? template.quasis[0]?.value.raw ?? "");
    }
    case "UnaryExpression": {
      const unary = node as UnaryExpressionNode;
      if (unary.operator !== "-" && unary.operator !== "+") {
        return err(new WorkflowParseError("meta unary expressions can only be numeric +/-"));
      }
      const argument = evaluateMetaLiteral(unary.argument);
      if (!argument.ok) return argument;
      if (typeof argument.value !== "number") {
        return err(new WorkflowParseError("meta unary expressions can only target numbers"));
      }
      return ok(unary.operator === "-" ? -argument.value : argument.value);
    }
    case "ArrayExpression": {
      const array = node as ArrayExpressionNode;
      const values: JsonValue[] = [];
      for (const element of array.elements) {
        if (!element) return err(new WorkflowParseError("meta arrays cannot contain holes"));
        const parsed = evaluateMetaLiteral(element);
        if (!parsed.ok) return parsed;
        values.push(parsed.value);
      }
      return ok(values);
    }
    case "ObjectExpression": {
      const object = node as ObjectExpressionNode;
      const value: Record<string, JsonValue> = {};
      for (const property of object.properties) {
        if (property.type !== "Property") return err(new WorkflowParseError("meta objects cannot contain spread"));
        if (property.computed || property.kind !== "init" || property.method) {
          return err(new WorkflowParseError("meta object properties must be static data properties"));
        }
        const key = propertyKey(property.key);
        if (!key.ok) return key;
        if (DANGEROUS_KEYS.has(key.value)) {
          return err(new WorkflowParseError(`meta object key is not allowed: ${key.value}`));
        }
        const parsed = evaluateMetaLiteral(property.value);
        if (!parsed.ok) return parsed;
        value[key.value] = parsed.value;
      }
      return ok(value);
    }
    default:
      return err(new WorkflowParseError(`meta contains executable expression: ${node.type}`));
  }
}

function propertyKey(node: ExpressionNode | IdentifierNode | PrivateIdentifierNode): Result<string, WorkflowParseError> {
  if (node.type === "Identifier") return ok((node as IdentifierNode).name);
  if (node.type === "Literal") {
    const value = (node as LiteralNode).value;
    if (typeof value === "string" || typeof value === "number") return ok(String(value));
  }
  return err(new WorkflowParseError("meta object keys must be identifiers or string/number literals"));
}

function buildMeta(raw: JsonValue): Result<WorkflowMeta, WorkflowParseError> {
  if (!isPlainRecord(raw)) return err(new WorkflowParseError("meta must be an object literal"));
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return err(new WorkflowParseError("meta.name must be a non-empty string"));
  }
  const description = raw.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return err(new WorkflowParseError("meta.description must be a non-empty string"));
  }
  // Claude-compatible phases: plain titles or {title, ...} entries; invalid
  // entries are dropped rather than failing the whole array.
  const phases = Array.isArray(raw.phases) ? raw.phases.flatMap(phaseTitle) : undefined;
  const budget = typeof raw.budget === "number" && Number.isFinite(raw.budget) ? raw.budget : undefined;
  return ok({ name, description, phases, budget, raw });
}

function phaseTitle(entry: JsonValue): string[] {
  if (typeof entry === "string" && entry.length > 0) return [entry];
  if (isPlainRecord(entry) && typeof entry.title === "string" && entry.title.length > 0) return [entry.title];
  return [];
}

function rejectStaticNondeterminism(program: ProgramNode): Result<void, WorkflowParseError> {
  let failure: WorkflowParseError | undefined;
  walk(program, (node) => {
    if (failure) return;
    if (isMemberExpressionNode(node) && !node.computed) {
      const object = node.object;
      const property = node.property;
      if (isIdentifierNode(object) && isIdentifierNode(property)) {
        if (object.name === "Date" && property.name === "now") {
          failure = new WorkflowParseError("Workflow source cannot reference Date.now");
        }
        if (object.name === "Math" && property.name === "random") {
          failure = new WorkflowParseError("Workflow source cannot reference Math.random");
        }
      }
    }
    if (isNewExpressionNode(node) && isIdentifierNode(node.callee) && node.callee.name === "Date") {
      if (node.arguments.length === 0) failure = new WorkflowParseError("Workflow source cannot call new Date() without arguments");
    }
  });
  return failure ? err(failure) : ok(undefined);
}

function rejectStaticDslMisuse(program: ProgramNode): Result<void, WorkflowParseError> {
  let failure: WorkflowParseError | undefined;
  walk(program, (node) => {
    if (failure || !isCallExpressionNode(node) || !isIdentifierNode(node.callee)) return;

    if (node.callee.name === "phase" && node.arguments.length > 1) {
      failure = new WorkflowParseError(
        'phase(title) returns void; call phase("name") as a statement, then run workflow work separately',
      );
      return;
    }

    if (node.callee.name === "agent" && node.arguments[0]?.type === "ObjectExpression") {
      failure = new WorkflowParseError(
        "agent(prompt, options?) expects the prompt as the first argument; do not use agent({ name, prompt })",
      );
      return;
    }

    if (node.callee.name === "parallel" && node.arguments[0]?.type === "ArrayExpression") {
      const array = node.arguments[0] as ArrayExpressionNode;
      if (array.elements.some((element) => element === null || isDefinitelyNotFunctionExpression(element))) {
        failure = new WorkflowParseError(
          "parallel([() => agent(...)]) expects an array of functions, not direct agent calls or promises",
        );
      }
    }
  });
  return failure ? err(failure) : ok(undefined);
}

function walk(node: Node, visit: (node: AnyNode) => void): void {
  visit(node as AnyNode);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit);
      }
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function isNode(value: unknown): value is Node {
  return isPlainRecord(value) && typeof value.type === "string" && typeof value.start === "number" && typeof value.end === "number";
}

function isMemberExpressionNode(node: AnyNode): node is MemberExpressionNode {
  return node.type === "MemberExpression";
}

function isNewExpressionNode(node: AnyNode): node is NewExpressionNode {
  return node.type === "NewExpression";
}

function isCallExpressionNode(node: AnyNode): node is CallExpressionNode {
  return node.type === "CallExpression";
}

function isIdentifierNode(node: ExpressionNode | IdentifierNode): node is IdentifierNode {
  return node.type === "Identifier";
}

function isFunctionExpression(node: ExpressionNode): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function isDefinitelyNotFunctionExpression(node: ExpressionNode): boolean {
  if (isFunctionExpression(node)) return false;
  if (node.type === "Identifier" || node.type === "MemberExpression") return false;
  return true;
}

type AnyNode = Node & { readonly type: string };
type ProgramNode = Node & { readonly type: "Program"; readonly body: StatementNode[] };
type StatementNode = Node & {
  readonly type: string;
  readonly declaration?: VariableDeclarationNode;
};
type VariableDeclarationNode = Node & {
  readonly type: "VariableDeclaration";
  readonly kind: "const" | "let" | "var";
  readonly declarations: VariableDeclaratorNode[];
};
type VariableDeclaratorNode = Node & {
  readonly type: "VariableDeclarator";
  readonly id: IdentifierNode;
  readonly init?: ExpressionNode;
};
type IdentifierNode = Node & { readonly type: "Identifier"; readonly name: string };
type PrivateIdentifierNode = Node & { readonly type: "PrivateIdentifier"; readonly name: string };
type LiteralNode = Node & { readonly type: "Literal"; readonly value: unknown };
type TemplateLiteralNode = Node & {
  readonly type: "TemplateLiteral";
  readonly expressions: ExpressionNode[];
  readonly quasis: Array<{ readonly value: { readonly cooked?: string; readonly raw: string } }>;
};
type UnaryExpressionNode = Node & {
  readonly type: "UnaryExpression";
  readonly operator: string;
  readonly argument: ExpressionNode;
};
type ArrayExpressionNode = Node & {
  readonly type: "ArrayExpression";
  readonly elements: Array<ExpressionNode | null>;
};
type ObjectExpressionNode = Node & {
  readonly type: "ObjectExpression";
  readonly properties: Array<PropertyNode | SpreadElementNode>;
};
type MemberExpressionNode = Node & {
  readonly type: "MemberExpression";
  readonly computed: boolean;
  readonly object: ExpressionNode | IdentifierNode;
  readonly property: ExpressionNode | IdentifierNode;
};
type NewExpressionNode = Node & {
  readonly type: "NewExpression";
  readonly callee: ExpressionNode | IdentifierNode;
  readonly arguments: ExpressionNode[];
};
type CallExpressionNode = Node & {
  readonly type: "CallExpression";
  readonly callee: ExpressionNode | IdentifierNode;
  readonly arguments: ExpressionNode[];
};
type ExpressionNode = Node & {
  readonly type: string;
  readonly value?: unknown;
  readonly operator?: string;
  readonly argument?: ExpressionNode;
  readonly elements?: Array<ExpressionNode | null>;
  readonly properties?: Array<PropertyNode | SpreadElementNode>;
  readonly expressions?: ExpressionNode[];
  readonly quasis?: Array<{ readonly value: { readonly cooked?: string; readonly raw: string } }>;
  readonly computed?: boolean;
  readonly object?: ExpressionNode | IdentifierNode;
  readonly property?: ExpressionNode | IdentifierNode;
  readonly callee?: ExpressionNode | IdentifierNode;
  readonly arguments?: ExpressionNode[];
};
type PropertyNode = Node & {
  readonly type: "Property";
  readonly key: ExpressionNode | IdentifierNode | PrivateIdentifierNode;
  readonly value: ExpressionNode;
  readonly computed: boolean;
  readonly kind: "init" | "get" | "set";
  readonly method: boolean;
};
type SpreadElementNode = Node & { readonly type: "SpreadElement" };
