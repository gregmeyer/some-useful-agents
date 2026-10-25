import { describe, it, expect } from 'vitest';
import { personPhotoOnPage } from './person-photo.js';

const page = (title: string, body: string, og?: string) => `<html><head><title>${title}</title>${og ? `<meta property="og:image" content="${og}">` : ''}</head><body>${body}</body></html>`;

describe('a picture of them', () => {
  it('takes one captioned with their name, or the picture of a page about them', () => {
    expect(personPhotoOnPage(page('Dana Reyes – Speaker', '<img src="/img/logo.png" alt="Northwind"><img src="/img/dana.jpg" alt="Dana Reyes, VP Operations">'), 'https://conf.example/speakers/dana-reyes', 'Dana Reyes'))
      .toEqual({ image: 'https://conf.example/img/dana.jpg', page: 'https://conf.example/speakers/dana-reyes', why: 'captioned with their name on a page about them' });
    expect(personPhotoOnPage(page('About Dana Reyes', '<h1>Dana Reyes</h1>', 'https://danareyes.example/me.jpg'), 'https://danareyes.example/about', 'Dana Reyes'))
      .toMatchObject({ image: 'https://danareyes.example/me.jpg', why: 'the picture of a page about them' });
    // Accents and case don't matter.
    expect(personPhotoOnPage(page('JOSÉ NÚÑEZ | Authors', '', 'https://blog.example/jn.png'), 'https://blog.example/authors/jose-nunez', 'José Núñez')).toMatchObject({ image: 'https://blog.example/jn.png' });
  });

  it('refuses a page that isn\'t about them, a logo, and a picture the page doesn\'t show as theirs', () => {
    expect(personPhotoOnPage(page('Northwind raises $20M', '<p>Dana Reyes said…</p>', 'https://news.example/hero.jpg'), 'https://news.example/2026/northwind', 'Dana Reyes')).toEqual({ why: "the page's title doesn't name them" });
    expect(personPhotoOnPage(page('Dana Reyes and Sam Lee on ops', '', 'https://pod.example/ep12.jpg'), 'https://pod.example/episodes/12', 'Dana Reyes')).toEqual({ why: "the page names them but isn't about them" });
    expect(personPhotoOnPage(page('Dana Reyes', '', 'https://danareyes.example/logo-share.png'), 'https://danareyes.example/', 'Dana Reyes')).toEqual({ why: 'no picture of them on the page' });
    // The research's own picture must be the one on that page.
    expect(personPhotoOnPage(page('Dana Reyes – Speaker', '<img src="/img/dana.jpg" alt="Dana Reyes">'), 'https://conf.example/speakers/dana-reyes', 'Dana Reyes', 'https://elsewhere.example/someone.jpg')).toEqual({ why: "the picture isn't one of them on that page" });
    expect(personPhotoOnPage(page('Dana Reyes – Speaker', '<img src="/img/dana.jpg?w=400" alt="Dana Reyes">'), 'https://conf.example/speakers/dana-reyes', 'Dana Reyes', 'https://conf.example/img/dana.jpg')).toMatchObject({ image: 'https://conf.example/img/dana.jpg' });
    expect(personPhotoOnPage(page('Dana', ''), 'https://x.example/', 'Dana')).toEqual({ why: 'needs a first and last name to check' });
  });
});
