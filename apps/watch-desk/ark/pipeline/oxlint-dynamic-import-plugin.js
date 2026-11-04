// Temporary bridge: Oxlint does not yet provide ESLint's generic
// `no-restricted-syntax` selector rule. Remove this plugin when its native
// equivalent can reject every ImportExpression, including computed imports.
const noDynamicImport = {
  meta: {
    messages: {
      dynamicImport: "Dynamic import() is not allowed in app code — use a top-level import.",
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        context.report({ messageId: "dynamicImport", node });
      },
    };
  },
};

export default {
  meta: { name: "ark" },
  rules: { "no-dynamic-import": noDynamicImport },
};
