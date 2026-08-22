import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  base: '/codepol/',
  title: 'Codepol',
  description:
    'Policy-driven code enforcement and architecture analysis for TypeScript and Python',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Rules', link: '/rules/' },
      { text: 'CLI', link: '/cli-reference' },
      { text: 'API Reference', link: '/api-reference' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Policy Schema', link: '/policy-schema' },
          { text: 'CLI Reference', link: '/cli-reference' },
          { text: 'Language Support', link: '/language-support' }
        ]
      },
      {
        text: 'Rules',
        items: [
          { text: 'Rule Catalog', link: '/rules/' },
          { text: 'enforce-casing', link: '/rules/enforce-casing' },
          { text: 'forbidden-declarations', link: '/rules/forbidden-declarations' },
          { text: 'no-mixed-exports', link: '/rules/no-mixed-exports' },
          { text: 'require-logger-enter-exit', link: '/rules/require-logger-enter-exit' }
        ]
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Architecture Analysis', link: '/architecture-analysis' },
          { text: 'Editor Integration', link: '/editor-integration' }
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
        text: 'Extending',
        items: [
          { text: 'Creating Custom Plugins', link: '/creating-custom-plugins' },
          { text: 'Adding a Lint Provider', link: '/adding-a-lint-provider' },
          { text: 'API Reference', link: '/api-reference' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fruitiecutiepie/codepol' }
    ]
  }
})
