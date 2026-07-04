module.exports = {
  appId: "studio.novel.local",
  productName: "Novel Studio",
  directories: {
    output: "release"
  },
  files: ["apps/desktop/dist/**", "packages/*/dist/**", "package.json", "package-lock.json"],
  extraMetadata: {
    main: "apps/desktop/dist/main/index.js"
  },
  npmRebuild: false,
  asar: true,
  win: {
    target: ["dir"]
  }
};
