# Visual regression checks

Every pull request runs `.github/workflows/visual.yml`. It renders every sample at every display
size twice, from the pull request's base and from the pull request, in the same Chromium on the
same machine, and compares them:

- **Samples:** every tree in `examples/`, every tree template, every tree of every
  [starter forest](templates.md) and one page with all the blueprints.
- **Displays:** Desktop large, Desktop XL, Tablet, Mobile landscape and Mobile portrait, each at
  its preview size, as full-page screenshots.
- **Pixels:** a screenshot counts as changed when more than 0.01% of its pixels differ
  (`pixelmatch`, threshold 0.1), or the page size changed.
- **Layout:** the box of every branch, matched by its position in the tree, so the report says
  which branches were added, removed, resized or moved, causes first.

Remote images are replaced with a grey placeholder and scripts, animations and transitions are
off, so the same document always gives the same picture. Because both sides render on the same
runner, there are no stored baselines to keep up to date.

## When the check fails

The job summary lists each changed sample and display with the share of pixels that changed and
the first branches that moved. The **visual-report** artifact has `index.html` with before, after
and diff images (changed pixels in red, magenta where one page is taller).

- If the change is a mistake, fix it and push.
- If it is intended, add the **`visual-change`** label to the pull request. The check runs again
  and passes, still listing what changed.

New samples (say, a new template) have nothing to compare against yet and are only listed.

## Locally

Build the packages first (`pnpm build:packages`), with Playwright's Chromium installed
(`pnpm exec playwright install chromium`, or `TW_CHROMIUM_PATH` for another Chrome):

```sh
pnpm visual:capture visual/before                 # on main (or: --root ../tree-weaver-main)
# make your change, pnpm build:packages
pnpm visual:capture visual/after
pnpm visual:diff visual/before visual/after visual/report   # open visual/report/index.html
```

`--root <dir>` captures another checkout with its own built packages, which is how CI renders the
base with the pull request's script.
