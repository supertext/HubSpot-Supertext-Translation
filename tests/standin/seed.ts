/**
 * The sample HubSpot account of the stand-in: a Swiss chocolate shop that
 * writes in English. One item of each kind, plus a page without a language and
 * a sent email. samples.json holds human translations of these texts into
 * German, French and Italian.
 */

export const PORTAL_ID = '48210377';
export const HUB_DOMAIN = 'swiss-chocolate.example';

/** Blogs and their language variants: posts can only get a language version where the blog has one. */
export const BLOGS: { id: string; language: string; translations: string[] }[] = [
  { id: 'blog-en', language: 'en', translations: ['de-ch', 'fr-ch'] },
];

type Item = Record<string, unknown> & { id: string };

export function seed(): Record<'site-page' | 'landing-page' | 'blog-post' | 'email' | 'kb-article', Item[]> {
  return {
    'site-page': [
      {
        id: '101',
        name: 'About us',
        language: 'en',
        state: 'PUBLISHED',
        currentlyPublished: true,
        slug: 'about-us',
        htmlTitle: 'About Swiss Chocolate Co.',
        metaDescription: 'Family-run chocolate makers in Bern since 1932.',
        featuredImageAltText: '',
        templatePath: '@hubspot/elevate/templates/about.hubl.html',
        updated: '2026-10-12T09:00:00Z',
        widgets: {
          header_1: { name: 'header_1', type: 'module', module_id: 1155232, body: { text: 'Made in Bern since 1932', heading_level: 'h1' } },
          rich_text: {
            name: 'rich_text',
            type: 'module',
            module_id: 1155639,
            body: {
              html: '<h2>Our story</h2><p>We make <strong>bean-to-bar</strong> chocolate in our workshop in Bern. <a href="https://example.com/visit">Visit us</a> on Saturdays.</p>',
            },
          },
          cta: {
            name: 'cta',
            type: 'module',
            // A link to another page of the site, as HubSpot's link field stores it (with the page's ID).
            body: {
              button_text: 'Order now',
              link: { url: { href: 'https://www.swiss-chocolate.example/contact', type: 'CONTENT', content_id: 102 } },
              style: { color: '#ff6e40' },
            },
          },
          hero_image: {
            name: 'hero_image',
            type: 'module',
            body: { img: { src: 'https://cdn.example.com/workshop.jpg', alt: 'Our workshop in Bern', width: 800 } },
          },
        },
        layoutSections: {
          dnd_area: {
            name: 'dnd_area',
            label: 'Main section',
            type: 'cell',
            cssClass: '',
            cssId: '',
            cssStyle: '',
            params: {},
            rowMetaData: [],
            styles: {},
            w: 12,
            x: 0,
            cells: [],
            rows: [
              {
                '0': {
                  name: 'dnd_area-module-1',
                  type: 'custom_widget',
                  label: 'Rich text',
                  params: { html: '<p>Every bar is wrapped by hand.</p>', path: '@hubspot/rich_text', schema_version: 2, css_class: 'dnd-module' },
                },
              },
            ],
          },
        },
      },
      {
        id: '102',
        name: 'Contact',
        language: '',
        state: 'DRAFT',
        slug: 'contact',
        htmlTitle: 'Contact',
        metaDescription: '',
        updated: '2026-10-10T09:00:00Z',
        widgets: { rich_text: { name: 'rich_text', type: 'module', body: { html: '<p>Write to us at any time.</p>' } } },
      },
    ],
    'landing-page': [
      {
        id: '201',
        name: 'Advent calendar 2026',
        language: 'en',
        state: 'DRAFT',
        slug: 'advent-calendar',
        htmlTitle: 'Advent calendar 2026',
        metaDescription: '24 handmade chocolates, one for every day until Christmas.',
        updated: '2026-10-14T09:00:00Z',
        widgets: {
          rich_text: {
            name: 'rich_text',
            type: 'module',
            body: {
              html: '<p>Hello {{ contact.firstname }}, our advent calendar is ready to order.</p><p>Order by 30 November for delivery before 1 December.</p>',
            },
          },
          form: { name: 'form', type: 'module', body: { form_id: 'f0e1d2c3', response_type: 'inline' } },
        },
      },
    ],
    'blog-post': [
      {
        id: '301',
        name: 'How we roast our cocoa beans',
        contentGroupId: 'blog-en',
        language: 'en',
        state: 'PUBLISHED',
        currentlyPublished: true,
        slug: 'blog/roasting',
        htmlTitle: 'How we roast our cocoa beans',
        metaDescription: 'A look inside our roasting room.',
        featuredImage: 'https://cdn.example.com/roaster.jpg',
        featuredImageAltText: 'Our roaster',
        postBody:
          '<p>Roasting brings out the flavour of the beans.</p><h2>Low and slow</h2><p>We roast at 120 °C for <em>forty minutes</em>.</p>',
        postSummary: '<p>Roasting brings out the flavour of the beans.</p>',
        tagIds: [7],
        updated: '2026-10-13T09:00:00Z',
      },
    ],
    email: [
      {
        id: '401',
        name: 'Autumn newsletter',
        subject: 'Our autumn chocolates are here',
        language: 'en',
        state: 'DRAFT',
        isPublished: false,
        type: 'BATCH_EMAIL',
        updatedAt: '2026-10-15T09:00:00Z',
        from: { fromName: 'Swiss Chocolate Co.', replyTo: 'hello@swiss-chocolate.example' },
        content: {
          templatePath: '@hubspot/email/dnd/welcome.html',
          styleSettings: { backgroundColor: '#ffffff', primaryAccentColor: '#ff6e40' },
          flexAreas: { main: { boxed: false, sections: [{ id: 'section-0', columns: [{ id: 'column-0-0', widgets: ['module-0-0-0'] }] }] } },
          widgets: {
            preview_text: { name: 'preview_text', type: 'text', body: { value: 'Hazelnut, chestnut and pumpkin spice' } },
            'module-0-0-0': {
              name: 'module-0-0-0',
              type: 'module',
              module_id: 1155639,
              body: {
                html: '<p>Hi {{ contact.firstname }},</p><p>Our autumn collection has arrived: <a href="https://shop.example.com/autumn">see all bars</a>.</p>',
              },
            },
            button: { name: 'button', type: 'module', body: { button_text: 'Shop now', destination: 'https://shop.example.com' } },
            // An image linking to a blog post.
            roasting: {
              name: 'roasting',
              type: 'module',
              body: { link: { url: { href: 'https://www.swiss-chocolate.example/blog/roasting', type: 'EXTERNAL' } } },
            },
          },
          plainTextVersion: 'Hi {{ contact.firstname }},\n\nOur autumn collection has arrived.\n\n{{ unsubscribe_link }}',
        },
        webversion: { enabled: true, title: 'Autumn newsletter', metaDescription: 'Our autumn chocolates are here' },
      },
      {
        id: '402',
        name: 'Summer sale',
        subject: 'Summer sale: 20% off',
        language: 'en',
        state: 'PUBLISHED',
        isPublished: true,
        type: 'BATCH_EMAIL',
        updatedAt: '2026-07-01T09:00:00Z',
        content: { widgets: { body: { name: 'body', type: 'module', body: { html: '<p>All bars 20% off this week.</p>' } } } },
      },
    ],
    'kb-article': [
      {
        id: '501',
        title: 'How do I track my order?',
        subtitle: 'Find your parcel in a few clicks',
        language: 'en',
        state: 'PUBLISHED',
        path: 'track-my-order',
        knowledgeBaseId: 'kb-1',
        categoryId: 'c-1',
        tagIds: [11],
        accessType: 'PUBLIC',
        archivedInDashboard: false,
        accessGroupIds: [],
        body:
          '<p>You receive a tracking link by e-mail as soon as your order ships.</p><ol><li>Open the e-mail.</li><li>Click <strong>Track parcel</strong>.</li></ol>',
        metaDescription: 'Tracking your chocolate order',
        updatedAt: '2026-10-11T09:00:00Z',
      },
      {
        id: '502',
        title: 'Returning an order',
        subtitle: 'Send chocolate back within 14 days',
        language: 'en',
        state: 'PUBLISHED',
        path: 'returning-an-order',
        knowledgeBaseId: 'kb-1',
        categoryId: 'c-1',
        tagIds: [],
        accessType: 'PUBLIC',
        archivedInDashboard: false,
        accessGroupIds: [],
        // Links between articles, as editors write them: full, relative, with an anchor; and others.
        body:
          '<h2 id="before">Before you send it back</h2><p>Find the parcel with <a href="https://help.swiss-chocolate.example/en/knowledge-base/track-my-order">tracking</a> first.</p>' +
          '<p>Damaged on arrival? See <a href="/en/knowledge-base/damaged-chocolate#photos">damaged chocolate</a>, <a href="#before">the first step</a> or <a href="https://www.swiss-chocolate.example/contact">our shop</a>.</p>',
        metaDescription: 'How to return an order',
        updatedAt: '2026-10-10T09:00:00Z',
      },
      {
        id: '503',
        title: 'Damaged chocolate',
        subtitle: 'What to do when chocolate arrives melted or broken',
        language: 'en',
        state: 'PUBLISHED',
        path: 'damaged-chocolate',
        knowledgeBaseId: 'kb-1',
        categoryId: 'c-1',
        tagIds: [],
        accessType: 'PUBLIC',
        archivedInDashboard: false,
        accessGroupIds: [],
        body: '<h2 id="photos">Take photos</h2><p>Photos help us replace it. Then follow <a href="https://help.swiss-chocolate.example/en/knowledge-base/returning-an-order">returning an order</a>.</p>',
        metaDescription: 'Melted or broken chocolate',
        updatedAt: '2026-10-09T09:00:00Z',
      },
    ],
  };
}
