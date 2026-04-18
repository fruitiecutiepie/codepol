import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  base: '/codepol/',
  title: 'Codepol',
  description: 'Policy-driven code enforcement for TypeScript projects',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'API Reference', link: '/api-reference' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Policy Schema', link: '/policy-schema' },
          { text: 'Creating Custom Plugins', link: '/creating-custom-plugins' },
          { text: 'Adding a Lint Provider', link: '/adding-a-lint-provider' },
          { text: 'API Reference', link: '/api-reference' }
        ]
      },
      {
        text: 'Semantic Index',
        items: [
          { text: 'Architecture', link: '/semantic-index' },
          { text: 'ProjectIndex API', link: '/project-index-api' },
          { text: 'Creating Language Adapters', link: '/creating-language-adapters' },
          { text: 'Cross-File Analysis Rules', link: '/cross-file-analysis' }
        ]
      },
      {
        text: 'Rules',
        items: [
          { text: 'require-logger-enter-exit', link: '/rules/require-logger-enter-exit' },
          { text: 'enforce-casing', link: '/rules/enforce-casing' },
          { text: 'no-mixed-exports', link: '/rules/no-mixed-exports' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fruitiecutiepie/codepol' }
    ]
  }
})
