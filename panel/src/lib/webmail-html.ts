import 'server-only'
import sanitizeHtml from 'sanitize-html'

const mailHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4',
    'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'table',
    'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    '*': ['style'],
    a: ['href', 'title', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'style'],
  },
  allowedStyles: {
    '*': {
      color: [/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,20})$/i],
      'background-color': [/^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,20})$/i],
      'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
      'font-weight': [/^(normal|bold|[1-9]00)$/i],
      'font-style': [/^(normal|italic|oblique)$/i],
      'text-align': [/^(left|right|center|justify)$/i],
      'text-decoration': [/^(none|underline|line-through)$/i],
      'font-family': [/^[\w\s,'"-]{1,80}$/],
      'vertical-align': [/^(top|middle|bottom|baseline)$/i],
      'white-space': [/^(normal|pre|pre-wrap|nowrap)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
}

export function sanitizeMailHtml(value: string, options: { allowRemoteImages?: boolean } = {}) {
  const allowedTags = options.allowRemoteImages ? [...(Array.isArray(mailHtmlOptions.allowedTags) ? mailHtmlOptions.allowedTags : []), 'img'] : mailHtmlOptions.allowedTags
  const allowedAttributes = options.allowRemoteImages
    ? { ...mailHtmlOptions.allowedAttributes, img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'] }
    : mailHtmlOptions.allowedAttributes
  return sanitizeHtml(value, {
    ...mailHtmlOptions,
    allowedTags,
    allowedAttributes,
  })
}
