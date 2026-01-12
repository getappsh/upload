module.exports = function (options, webpack) {
  return {
    ...options,
    externalsPresets: { node: true },
    externals: [
      ...(options.externals || []),
      // Use a regex to match the module and keep it external
      /@usex\/rule-engine/,
    ],
  };
};
