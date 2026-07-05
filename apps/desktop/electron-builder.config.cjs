module.exports = {
  appId: "studio.novel.local",
  productName: "Novel Studio",
  artifactName: "Novel-Studio-${version}-${os}-${arch}.${ext}",
  directories: {
    output: process.env.NOVEL_STUDIO_PACKAGE_OUTPUT ?? "release",
    buildResources: "apps/desktop/build"
  },
  files: ["apps/desktop/dist/**", "packages/*/dist/**", "package.json", "package-lock.json"],
  extraMetadata: {
    main: "apps/desktop/dist/main/index.js"
  },
  npmRebuild: false,
  asar: true,
  win: {
    icon: "apps/desktop/build/icon.svg",
    forceCodeSigning: false,
    target: ["dir", "nsis"]
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Novel Studio"
  }
};
