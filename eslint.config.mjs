import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
	{ ignores: ['**/dist', '**/node_modules'] },
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			indent: ['error', 4, { SwitchCase: 1 }],
			'no-underscore-dangle': ['error', {
				allow: ['_id', '_outputSeqNo', '_queueOrderNo', '_skipOutput', '_retryCount', '_crashesCount', '_pageFailed', '_pageCrashed'],
				allowAfterThis: true,
			}],
			'no-use-before-define': 'off',
			'no-param-reassign': 'off',
			'consistent-return': 'off',
			'array-callback-return': 'off',
			'no-plusplus': 'off',
			'max-len': ['error', 150],
			quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
			'func-names': 'off',
			'import/no-extraneous-dependencies': 'off',
			'import/prefer-default-export': 'off',
			'import/no-unresolved': 'off',
			'class-methods-use-this': 'off',
			strict: 'off',
			'object-curly-newline': 'off',
			'no-await-in-loop': 'off',
			'arrow-body-style': 'off',
			'import/no-named-as-default': 'off',
			'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
			'no-prototype-builtins': 'off',
		},
	},
	prettier,
];
