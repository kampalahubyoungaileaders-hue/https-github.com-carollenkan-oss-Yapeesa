// Money-domain code must use bigint. This intentionally bans all JS numbers
// there, including integer-looking numbers whose arithmetic could overflow.
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden: 'Use bigint minor units and integer arithmetic in money code.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'number')
          context.report({ node, messageId: 'forbidden' });
      },
      TSNumberKeyword(node) {
        context.report({ node, messageId: 'forbidden' });
      },
      Identifier(node) {
        if (['Number', 'parseFloat', 'parseInt', 'Math'].includes(node.name))
          context.report({ node, messageId: 'forbidden' });
      },
      UnaryExpression(node) {
        if (node.operator === '+')
          context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};
