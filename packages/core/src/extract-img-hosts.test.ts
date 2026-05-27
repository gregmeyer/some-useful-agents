import { describe, it, expect } from 'vitest';
import { extractImgHosts, mergeImgSrcHosts } from './extract-img-hosts.js';

describe('extractImgHosts', () => {
  it('returns empty array when there is no outputWidget', () => {
    expect(extractImgHosts({})).toEqual([]);
  });

  it('returns empty array when template is empty', () => {
    expect(extractImgHosts({ outputWidget: { template: '' } })).toEqual([]);
  });

  it('extracts a single external host', () => {
    const tpl = '<div><img src="https://apod.nasa.gov/apod/image/x.jpg"></div>';
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual(['apod.nasa.gov']);
  });

  it('extracts multiple distinct hosts and de-dupes + sorts', () => {
    const tpl = `
      <img src="https://images.unsplash.com/photo-1">
      <img src="https://www.thecocktaildb.com/images/drink.jpg">
      <img src="https://apod.nasa.gov/apod/image/y.jpg">
      <img src="https://images.unsplash.com/photo-2">
    `;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual([
      'apod.nasa.gov',
      'images.unsplash.com',
      'www.thecocktaildb.com',
    ]);
  });

  it('handles single-quoted src attributes', () => {
    const tpl = `<img src='https://apod.nasa.gov/x.jpg'>`;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual(['apod.nasa.gov']);
  });

  it('filters out CSP-baseline hosts (img.youtube.com, i.vimeocdn.com)', () => {
    const tpl = `
      <img src="https://img.youtube.com/vi/abc/0.jpg">
      <img src="https://i.vimeocdn.com/video/123.jpg">
      <img src="https://apod.nasa.gov/x.jpg">
    `;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual(['apod.nasa.gov']);
  });

  it('lowercases hostnames', () => {
    const tpl = `<img src="https://APOD.NASA.GOV/x.jpg">`;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual(['apod.nasa.gov']);
  });

  it('skips http: data: and inline base64', () => {
    const tpl = `
      <img src="http://insecure.example.com/x.jpg">
      <img src="data:image/png;base64,abc">
      <img src="https://apod.nasa.gov/x.jpg">
    `;
    // http: still matches (CSP allows http if declared, though the dashboard uses https). For
    // safety we extract it — the user can prune via the imgSrc form.
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual([
      'apod.nasa.gov',
      'insecure.example.com',
    ]);
  });

  it('skips IP-literal hosts', () => {
    const tpl = `<img src="https://192.168.1.1/x.jpg">`;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual([]);
  });

  it('handles arbitrary attribute order and whitespace before src', () => {
    const tpl = `
      <img class="hero" alt="Astronomy"
           src="https://apod.nasa.gov/x.jpg" width="320">
      <img loading="lazy" src='https://images.unsplash.com/y.jpg' />
    `;
    expect(extractImgHosts({ outputWidget: { template: tpl } })).toEqual([
      'apod.nasa.gov',
      'images.unsplash.com',
    ]);
  });

  it('is reentrant — repeated calls return the same result (regex state reset)', () => {
    const tpl = '<img src="https://a.example.com/1"><img src="https://b.example.com/2">';
    const first = extractImgHosts({ outputWidget: { template: tpl } });
    const second = extractImgHosts({ outputWidget: { template: tpl } });
    expect(first).toEqual(['a.example.com', 'b.example.com']);
    expect(second).toEqual(first);
  });
});

describe('mergeImgSrcHosts', () => {
  it('returns sorted union of existing + extracted, de-duped', () => {
    expect(mergeImgSrcHosts(['b.example.com'], ['a.example.com', 'b.example.com'])).toEqual([
      'a.example.com',
      'b.example.com',
    ]);
  });

  it('preserves wildcard entries from existing (analyser can\'t infer wildcards)', () => {
    expect(mergeImgSrcHosts(['*.unsplash.com'], ['images.unsplash.com'])).toEqual([
      '*.unsplash.com',
      'images.unsplash.com',
    ]);
  });

  it('lowercases + trims existing entries', () => {
    expect(mergeImgSrcHosts([' APOD.NASA.GOV '], [])).toEqual(['apod.nasa.gov']);
  });

  it('handles undefined existing', () => {
    expect(mergeImgSrcHosts(undefined, ['a.example.com'])).toEqual(['a.example.com']);
  });

  it('returns empty when both inputs empty', () => {
    expect(mergeImgSrcHosts(undefined, [])).toEqual([]);
  });
});
