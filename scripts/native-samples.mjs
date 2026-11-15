#!/usr/bin/env node
/**
 * Writes sample SwiftUI and Flutter exports so CI can compile them.
 *
 *   node scripts/native-samples.mjs [outDir]   (default: native-samples)
 *
 * The samples are every example tree in examples/, every tree template, and one tree that
 * holds every palette blueprint, exported with the Weaver Basic kit plus the tree's own kits.
 * Output:
 *   <out>/swift/Sources/TreeWeaverSamples/*.swift   a Swift package (swift build / xcodebuild)
 *   <out>/flutter/lib/samples/*.dart + lib/main.dart a Flutter app, with a widget test that lays
 *     every sample out at desktop, tablet and phone widths (flutter analyze / flutter test)
 *
 * Build the packages first (pnpm build:packages).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (pkg) => import(join(root, 'packages', pkg, 'dist', 'index.js'));
const [{ createBranch, createKit, createTree }, { exportSwiftUI, exportFlutter, importJson, dartFileName }, { BLUEPRINTS, TEMPLATES }, { WEAVER_BASIC_CSS }] = await Promise.all(
  ['core', 'formats', 'branches', 'kits'].map(load),
);

const out = resolve(process.argv[2] ?? join(root, 'native-samples'));
rmSync(out, { recursive: true, force: true });

const basic = createKit('Weaver Basic', WEAVER_BASIC_CSS);
/** @type {{ tree: import('@tree-weaver/core').Tree, kits: import('@tree-weaver/core').DesignKit[] }[]} */
const samples = [];

for (const file of readdirSync(join(root, 'examples')).sort()) {
  if (!/\.(tree|forest)\.json$/.test(file)) continue;
  const doc = importJson(readFileSync(join(root, 'examples', file), 'utf8'));
  if (doc.kind === 'tree') samples.push({ tree: doc.tree, kits: [basic, ...doc.kits] });
  else for (const tree of doc.forest.trees) samples.push({ tree, kits: [basic, ...doc.forest.kits] });
}
for (const t of TEMPLATES) samples.push({ tree: t.create(`Template ${t.label}`), kits: [basic] });
samples.push({
  tree: createTree('All blueprints', createBranch({ tag: 'body', type: 'root', name: 'Body', children: BLUEPRINTS.filter((b) => b.category !== 'SVG').map((b) => b.create()) })),
  kits: [basic],
});

const used = new Set();
const names = samples.map(({ tree }) => {
  const base = `Sample${tree.name.split(/[^A-Za-z0-9]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
});

const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

/* Swift package: one library target holding every view, plus a list view that uses them all. */
const swift = join(out, 'swift');
write(
  join(swift, 'Package.swift'),
  `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TreeWeaverSamples",
    platforms: [.iOS(.v16), .macOS(.v13)], // the oldest the exports support,
    products: [.library(name: "TreeWeaverSamples", targets: ["TreeWeaverSamples"])],
    targets: [.target(name: "TreeWeaverSamples")]
)
`,
);
samples.forEach(({ tree, kits }, i) => write(join(swift, 'Sources', 'TreeWeaverSamples', `${names[i]}.swift`), exportSwiftUI(tree, { name: names[i], kits })));
write(
  join(swift, 'Sources', 'TreeWeaverSamples', 'AllSamples.swift'),
  `import SwiftUI

public struct AllSamples: View {
    public init() {}
    public var body: some View {
        NavigationStack {
            List {
${names.map((n) => `                NavigationLink("${n}") { ${n}() }`).join('\n')}
            }
        }
    }
}
`,
);

/* Flutter app: every widget under lib/samples, and a main.dart that routes to each. */
const flutter = join(out, 'flutter');
write(
  join(flutter, 'pubspec.yaml'),
  `name: tree_weaver_samples
description: Sample Tree Weaver Flutter exports, compiled in CI.
publish_to: none
version: 0.0.1
environment:
  sdk: ^3.6.0
dependencies:
  flutter:
    sdk: flutter
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0
flutter:
  uses-material-design: true
`,
);
write(join(flutter, 'analysis_options.yaml'), 'include: package:flutter_lints/flutter.yaml\n');
samples.forEach(({ tree, kits }, i) => write(join(flutter, 'lib', 'samples', dartFileName(names[i])), exportFlutter(tree, { name: names[i], kits })));
write(
  join(flutter, 'lib', 'main.dart'),
  `import 'package:flutter/material.dart';
${names.map((n) => `import 'samples/${dartFileName(n)}';`).join('\n')}

void main() => runApp(const SamplesApp());

const samples = <String, Widget>{
${names.map((n) => `  '${n}': ${n}(),`).join('\n')}
};

class SamplesApp extends StatelessWidget {
  const SamplesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: ListView(
            children: [
              for (final entry in samples.entries)
                ListTile(
                  title: Text(entry.key),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => Scaffold(body: entry.value)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
`,
);

write(
  join(flutter, 'test', 'samples_test.dart'),
  `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tree_weaver_samples/main.dart';

void main() {
  for (final entry in samples.entries) {
    for (final width in [1280.0, 800.0, 390.0]) {
      testWidgets('\${entry.key} lays out at \$width wide', (tester) async {
        final errors = <FlutterErrorDetails>[];
        final previous = FlutterError.onError;
        FlutterError.onError = (details) {
          // Network images can't load in tests; anything else (overflow, unbounded sizes) is a bug.
          if (details.library == 'image resource service') return;
          errors.add(details);
        };
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(MaterialApp(home: Scaffold(body: entry.value)));
        await tester.pump();
        FlutterError.onError = previous;
        expect(errors.map((e) => e.exceptionAsString()).toList(), isEmpty);
      });
    }
  }
}
`,
);

console.log(`Wrote ${samples.length} samples to ${out}`);
