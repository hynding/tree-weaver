import { createBranch, createKit, createShape, createSvgTree, createTree, text, type BranchInit } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { cssColor, cssLength, dartFileName, exportComponent, exportFlutter, exportSwiftUI } from './index';

const pageTree = (name: string, children: BranchInit['children']) => createTree(name, createBranch({ tag: 'body', type: 'root', name: 'Body', children }));

const page = () =>
  pageTree('Landing page', [
    createBranch({
      tag: 'nav',
      styles: { lg: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', padding: '16px 32px' }, 'mobile-portrait': { 'flex-direction': 'column', gap: '8px' } },
      children: [createBranch({ tag: 'strong', children: [text('Acme')] }), createBranch({ tag: 'a', attrs: { href: 'https://example.com' }, children: [text('Docs')] })],
    }),
    createBranch({
      tag: 'section',
      styles: { lg: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '1.5rem', background: '#f6f8fa' }, 'mobile-portrait': { 'grid-template-columns': '1fr' } },
      children: [
        createBranch({ tag: 'div', classes: ['card'], children: [createBranch({ tag: 'h2', children: [text('Say "hi" \\ $5')] })] }),
        createBranch({ tag: 'img', attrs: { src: 'https://example.com/a.png', alt: 'A picture' } }),
        createBranch({ tag: 'p', styles: { 'mobile-portrait': { display: 'none' } }, children: [text('Desktop only')] }),
      ],
    }),
    createBranch({ tag: 'ul', children: [createBranch({ tag: 'li', children: [text('One')] }), createBranch({ tag: 'li', children: [text('Two')] })] }),
    createBranch({ tag: 'input', attrs: { placeholder: 'Email' } }),
    createBranch({ tag: 'hr' }),
  ]);

const kits = [createKit('Kit', ':root { --brand: #ff0000; --pad: 12px; } .card { background: var(--brand); padding: var(--pad); border-radius: 8px; }')];

describe('value helpers', () => {
  it('reads lengths in points', () => {
    expect(cssLength('16px')).toBe(16);
    expect(cssLength('1.5rem')).toBe(24);
    expect(cssLength('0')).toBe(0);
    expect(cssLength('50%')).toBeUndefined();
    expect(cssLength('auto')).toBeUndefined();
  });

  it('reads colours', () => {
    expect(cssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(cssColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(cssColor('red')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(cssColor('var(--x)')).toBeUndefined();
  });

  it('names Dart files in snake case', () => {
    expect(dartFileName('LandingPage')).toBe('landing_page.dart');
  });
});

describe('exportSwiftUI', () => {
  const swift = exportSwiftUI(page(), { name: 'LandingPage', kits });

  it('writes a view that switches on the size class, guarded for macOS', () => {
    expect(swift).toContain('import SwiftUI');
    expect(swift).toContain('struct LandingPage: View {');
    expect(swift).toMatch(/#if os\(iOS\)\n\s+@Environment\(\\\.horizontalSizeClass\)/);
    expect(swift).toContain('private let compact = false');
    expect(swift).toContain('#Preview {');
  });

  it('carries layout changes between displays', () => {
    expect(swift).toContain('AnyLayout(VStackLayout');
    expect(swift).toMatch(/LazyVGrid\(columns: \(compact \? .*count: 1\) : .*count: 3\)\)/);
    expect(swift).toMatch(/if !compact \{\n\s+Text\("Desktop only"\)/);
  });

  it('maps content to native views', () => {
    expect(swift).toContain('Link("Docs", destination: URL(string: "https://example.com")!)');
    expect(swift).toContain('AsyncImage(url: URL(string: "https://example.com/a.png"))');
    expect(swift).toContain('.accessibilityLabel("A picture")');
    expect(swift).toContain('TextField("Email"');
    expect(swift).toContain('Divider()');
    expect(swift).toContain('Text("One")');
  });

  it('escapes strings', () => {
    expect(swift).toContain('Text("Say \\"hi\\" \\\\ $5")');
  });

  it('applies design kit rules with tokens resolved', () => {
    expect(swift).toContain('.background(Color(red: 1, green: 0, blue: 0))');
    expect(swift).toContain('.padding(12)');
    expect(swift).toContain('RoundedRectangle(cornerRadius: 8)');
  });
});

describe('exportFlutter', () => {
  const dart = exportFlutter(page(), { name: 'LandingPage', kits });

  it('writes a widget that switches on screen width', () => {
    expect(dart).toContain("import 'package:flutter/material.dart';");
    expect(dart).toContain('class LandingPage extends StatelessWidget {');
    expect(dart).toContain('final phone = width <= 600;');
    expect(dart).toContain('SingleChildScrollView(');
  });

  it('carries layout changes between displays', () => {
    expect(dart).toContain('direction: (phone ? Axis.vertical : Axis.horizontal)');
    expect(dart).toContain('Flexible(flex: (phone ? 0 : 1), child:');
    expect(dart).toContain('mainAxisSize: (phone ? MainAxisSize.min : MainAxisSize.max)');
    expect(dart).toMatch(/_Grid\(columns: \(phone \? 1 : 3\)/);
    expect(dart).toContain('class _Grid extends StatelessWidget');
    expect(dart).toMatch(/if \(!phone\)[\s\S]*Desktop only/);
  });

  it('maps content to widgets and escapes strings', () => {
    expect(dart).toContain("Image.network('https://example.com/a.png'");
    expect(dart).toContain("semanticLabel: 'A picture'");
    expect(dart).toContain('TextField(');
    expect(dart).toContain('Divider(');
    expect(dart).toContain("'Say \"hi\" \\\\ \\$5'");
  });

  it('passes every grid argument and sizes with SizedBox (no analyzer warnings)', () => {
    expect(dart).toMatch(/_Grid\(columns: \(phone \? 1 : 3\), minColumnWidth: null,/);
    expect(dart).toContain('required this.minColumnWidth');
    const sized = exportFlutter(pageTree('Sized', [createBranch({ tag: 'div', styles: { lg: { height: '32px' } }, children: [text('Gap')] })]), { name: 'Sized' });
    expect(sized).toContain('SizedBox(');
    expect(sized).not.toContain('Container(');
  });

  it('applies design kit rules with tokens resolved', () => {
    expect(dart).toContain('color: Color(0xFFFF0000)');
    expect(dart).toContain('BorderRadius.circular(8)');
  });

  it('drops unused width flags', () => {
    const plain = exportFlutter(pageTree('Plain', [createBranch({ tag: 'p', children: [text('Hi')] })]), { name: 'Plain' });
    expect(plain).not.toContain('final phone');
    expect(plain).not.toContain('final tablet');
    expect(plain).not.toContain('final width');
    expect(plain).not.toContain('_Grid');
  });
});

describe('exportComponent with native frameworks', () => {
  it('writes one Swift file', () => {
    const out = exportComponent(page(), { framework: 'swiftui', styling: 'tailwind', kits });
    expect(out.entry).toBe('LandingPage.swift');
    expect(out.files.map((f) => f.path)).toEqual(['LandingPage.swift']);
    expect(out.styling).toBeUndefined();
  });

  it('writes one Dart file named in snake case', () => {
    const out = exportComponent(page(), { framework: 'flutter', name: 'Home screen' });
    expect(out.name).toBe('HomeScreen');
    expect(out.files.map((f) => f.path)).toEqual(['home_screen.dart']);
    expect(out.files[0].contents).toContain('class HomeScreen extends StatelessWidget');
  });

  it('renames a component that would shadow a framework type', () => {
    expect(exportComponent(page(), { framework: 'flutter', name: 'Table' }).files[0].contents).toContain('class TableWidget extends StatelessWidget');
    expect(exportComponent(page(), { framework: 'swiftui', name: 'Text' }).entry).toBe('TextView.swift');
  });

  it('says what an SVG tree becomes', () => {
    const svg = createSvgTree('Logo', [createShape('circle', { cx: '10', cy: '10', r: '5' })]);
    for (const framework of ['swiftui', 'flutter'] as const) {
      const out = exportComponent(svg, { framework });
      expect(out.files[0].contents).toMatch(/SVG/);
    }
  });
});

describe('native edge cases', () => {
  const tree = () =>
    pageTree('Edge', [
      createBranch({ tag: 'section', styles: { lg: { 'min-height': '400px', '--accent': '#0066cc', border: '1px solid var(--accent)' } }, children: [text('Tall')] }),
      createBranch({ tag: 'a', attrs: { href: 'https://example.com/my page' }, children: [text('Back\bspace')] }),
      createBranch({
        tag: 'table',
        children: [
          createBranch({
            tag: 'tr',
            children: [
              createBranch({ tag: 'th', styles: { 'mobile-portrait': { display: 'none' } }, children: [text('Head')] }),
              createBranch({ tag: 'th', children: [text('Other')] }),
            ],
          }),
        ],
      }),
      createBranch({ tag: 'ul', children: [createBranch({ tag: 'li', styles: { 'mobile-portrait': { display: 'none' } }, children: [text('Wide only')] })] }),
    ]);

  it('treats min-height as a floor, not a fixed height', () => {
    const swift = exportSwiftUI(tree(), { name: 'Edge' });
    expect(swift).toContain('.frame(minHeight: 400');
    expect(swift).not.toContain('.frame(height: 400');
    expect(exportFlutter(tree(), { name: 'Edge' })).toContain('constraints: BoxConstraints(minHeight: 400)');
  });

  it('resolves custom properties set on the branch', () => {
    expect(exportSwiftUI(tree(), { name: 'Edge' })).toContain('Color(red: 0, green: 0.4, blue: 0.8)');
  });

  it('encodes URLs and writes only Swift escapes', () => {
    const swift = exportSwiftUI(tree(), { name: 'Edge' });
    expect(swift).toContain('URL(string: "https://example.com/my%20page")!');
    expect(swift).toContain('"Back\\u{8}space"');
  });

  it('keeps hidden header cells compilable in SwiftUI', () => {
    expect(exportSwiftUI(tree(), { name: 'Edge' })).toMatch(/Group \{\n\s+if !compact \{\n\s+Text\("Head"\)[\s\S]*?\}\n\s+\}\n\s+\.fontWeight\(\.semibold\)/);
  });

  it('hides list items and table cells in Flutter too', () => {
    const dart = exportFlutter(tree(), { name: 'Edge' });
    expect(dart).toMatch(/Visibility\(visible: !phone, child:\n\s+Text\('Head'/);
    expect(dart).toMatch(/if \(!phone\) Row\([\s\S]*Wide only/);
    expect(dart).not.toContain('IntrinsicHeight');
  });
});
