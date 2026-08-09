const engineeringFileAccessArtifacts = [
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s"
];

module.exports = {
  appId: "studio.novel.local",
  productName: "Novel Studio",
  artifactName: "Novel-Studio-${version}-${os}-${arch}.${ext}",
  directories: {
    output: process.env.NOVEL_STUDIO_PACKAGE_OUTPUT ?? "release",
    buildResources: "apps/desktop/build"
  },
  files: [
    "apps/desktop/dist/**",
    "!apps/desktop/dist/test{,/**}",
    "packages/*/dist/**",
    "!packages/*/dist/test{,/**}",
    "packages/schemas/schema/**",
    "package.json",
    "package-lock.json",
    ...engineeringFileAccessArtifacts
  ],
  asarUnpack: [...engineeringFileAccessArtifacts],
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  },
  extraResources: [],
  extraMetadata: {
    main: "apps/desktop/dist/main/index.js"
  },
  npmRebuild: false,
  asar: true,
  electronLanguages: ["zh-CN", "en-US"],
  win: {
    icon: "apps/desktop/build/icon-shanhai.png",
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
