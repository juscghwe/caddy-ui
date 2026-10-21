import { parse } from '@babel/parser';

function literal(node) {
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    return null;
}

// Cruiser owns resolution; this pass adds source evidence and Vite glob metadata.
export function sourceReferences(source, filename) {
    const ast = parse(source, { sourceType: 'unambiguous', sourceFilename: filename,
        plugins: ['jsx'], createImportExpressions: true });
    const references = [];
    function add(node, kind, specifier, extra = {}) {
        references.push({ kind, specifier, line: node.loc.start.line, column: node.loc.start.column + 1,
            excerpt: source.slice(node.start, node.end).slice(0, 240), ...extra });
    }
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'ImportDeclaration') add(node, 'import', node.source.value);
        if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) add(node, 're-export', node.source.value);
        if (node.type === 'ImportExpression') add(node, 'dynamic-import', literal(node.source));
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') add(node, 'require', literal(node.arguments[0]));
        const callee = node.type === 'CallExpression' && node.callee;
        if (callee?.type === 'MemberExpression' && !callee.computed && callee.property.name === 'glob'
            && callee.object.type === 'MetaProperty' && callee.object.meta.name === 'import' && callee.object.property.name === 'meta') {
            const argument = node.arguments[0];
            const patterns = argument?.type === 'ArrayExpression' ? argument.elements.map(literal) : [literal(argument)];
            const options = node.arguments[1];
            const unsupportedOptions = options && (options.type !== 'ObjectExpression' || options.properties.some(property =>
                property.type !== 'ObjectProperty' || property.computed || (property.key.name || property.key.value) !== 'eager'
                || property.value.type !== 'BooleanLiteral'));
            const eagerOption = options?.type === 'ObjectExpression' && options.properties.findLast(property =>
                property.type === 'ObjectProperty' && !property.computed && (property.key.name || property.key.value) === 'eager');
            const eager = eagerOption?.value?.type === 'BooleanLiteral' && eagerOption.value.value;
            add(node, eager ? 'glob-eager' : 'glob-lazy', null, { patterns, unsupportedOptions: Boolean(unsupportedOptions) });
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child); });
            else if (value?.type) visit(value);
        }
    }
    visit(ast.program);
    return references.sort((a, b) => a.line - b.line || a.column - b.column);
}
