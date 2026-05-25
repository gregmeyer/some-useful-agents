import { describe, it, expect } from 'vitest';
import {
  extractImgTagHosts,
  unallowedWidgetImageHosts,
  formatBlockedImageError,
} from './widget-image-hosts.js';

describe('extractImgTagHosts', () => {
  it('pulls lowercased hosts from http(s) <img> srcs', () => {
    const html =
      '<img src="https://CDN.Example.com/a.png"> text <img src=\'http://other.io/b\'>';
    expect(extractImgTagHosts(html).sort()).toEqual(['cdn.example.com', 'other.io']);
  });

  it('ignores data URIs and relative (same-origin) srcs', () => {
    const html =
      '<img src="data:image/png;base64,AAAA"><img src="/output-file?path=/x.png">';
    expect(extractImgTagHosts(html)).toEqual([]);
  });

  it('de-dups repeated hosts', () => {
    const html = '<img src="https://h/a.png"><img src="https://h/b.png">';
    expect(extractImgTagHosts(html)).toEqual(['h']);
  });
});

describe('unallowedWidgetImageHosts', () => {
  const template = '<div><img src="{{outputs.image_url}}" alt="x"></div>';

  it('returns [] when there is no ai-template widget', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'dashboard', template },
      permissions: { imgSrc: [] },
      result: JSON.stringify({ image_url: 'https://blocked.example/x.png' }),
    })).toEqual([]);
  });

  it('returns [] when there is no result', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template },
      permissions: { imgSrc: [] },
      result: undefined,
    })).toEqual([]);
  });

  it('flags a runtime image host not in permissions.imgSrc', () => {
    const bad = unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template },
      permissions: { imgSrc: ['allowed.example'] },
      result: JSON.stringify({ image_url: 'https://blocked.example/portrait.jpg' }),
    });
    expect(bad).toEqual(['blocked.example']);
  });

  it('passes when the runtime host IS allowlisted', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template },
      permissions: { imgSrc: ['upload.wikimedia.org'] },
      result: JSON.stringify({ image_url: 'https://upload.wikimedia.org/a/b/x.jpg' }),
    })).toEqual([]);
  });

  it('honours wildcard allowlist entries', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template },
      permissions: { imgSrc: ['*.wikimedia.org'] },
      result: JSON.stringify({ image_url: 'https://upload.wikimedia.org/a/b/x.jpg' }),
    })).toEqual([]);
  });

  it('returns [] when the rendered template has no external image', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template: '<p>{{outputs.title}}</p>' },
      permissions: {},
      result: JSON.stringify({ title: 'hi' }),
    })).toEqual([]);
  });

  it('recovers JSON from markdown-fenced output', () => {
    const bad = unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template },
      permissions: {},
      result: '```json\n{"image_url":"https://blocked.example/x.png"}\n```',
    });
    expect(bad).toEqual(['blocked.example']);
  });

  it('catches a hardcoded blocked host in the template itself', () => {
    expect(unallowedWidgetImageHosts({
      outputWidget: { type: 'ai-template', template: '<img src="https://hard.example/logo.png">' },
      permissions: { imgSrc: [] },
      result: '{}',
    })).toEqual(['hard.example']);
  });
});

describe('formatBlockedImageError', () => {
  it('names a single host with singular phrasing', () => {
    const msg = formatBlockedImageError(['blocked.example']);
    expect(msg).toMatch(/image host not allowed/);
    expect(msg).toMatch(/blocked\.example/);
    expect(msg).toMatch(/permissions\.imgSrc/);
  });

  it('names multiple hosts with plural phrasing', () => {
    const msg = formatBlockedImageError(['a.example', 'b.example']);
    expect(msg).toMatch(/image hosts not allowed/);
    expect(msg).toMatch(/a\.example, b\.example/);
  });
});
