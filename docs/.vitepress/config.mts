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
          { text: 'API Reference', link: '/api-reference' }
        ]
      },
      {
        text: 'Rules',
        items: [
          { text: 'require-logger-enter-exit', link: '/rules/require-logger-enter-exit' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fruitiecutiepie/codepol' }
    ]
  }
})
