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
    "package-lock.json"
  ],
  extraResources: [
    {
      // Development deliberately ships the unavailable placeholder. Release
      // packaging must opt in to a directory produced by prepare-git-runtime.
      from: process.env.NOVEL_STUDIO_GIT_RUNTIME_DIR ?? "apps/desktop/resources/git",
      to: "git"
    },
    {
      // CI can stage real, hash-addressed binaries without mutating the
      // fail-closed source-tree placeholder used by local development.
      from:
        process.env.NOVEL_STUDIO_AGENT_SANDBOX_DIR ??
        "apps/desktop/resources/native/agent-task-sandbox",
      to: "native/agent-task-sandbox"
    },
    {
      // The file lifecycle host has an independent qualification artifact.
      // Source builds ship only an unavailable placeholder.
      from:
        process.env.NOVEL_STUDIO_AGENT_FILE_OPERATIONS_DIR ??
        "apps/desktop/resources/native/agent-file-operations",
      to: "native/agent-file-operations"
    }
  ],
  extraMetadata: {
    main: "apps/desktop/dist/main/index.js"
  },
  npmRebuild: false,
  asar: true,
  electronLanguages: ["zh-CN", "en-US"],
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
