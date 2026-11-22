// Stylelint 配置。仅报告，不阻断提交。
// 关闭纯风格偏好类规则，聚焦「无效/错误」类问题。
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', 'node_modules/**'],
  rules: {
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'value-keyword-case': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'at-rule-empty-line-before': null,
    'rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'selector-attribute-quotes': null,
    'no-descending-specificity': null,
    'property-no-vendor-prefix': null,
    'color-hex-length': null,
    'declaration-empty-line-before': null,
    'font-family-name-quotes': null,
    'media-feature-range-notation': null,
  },
};
