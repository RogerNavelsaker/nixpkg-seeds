{ bash, bun2nix, fetchFromGitHub, installShellFiles, lib, symlinkJoin }:

let
  manifest = builtins.fromJSON (builtins.readFile ./package-manifest.json);
  packageVersion =
    manifest.package.version
    + lib.optionalString (manifest.package ? packageRevision) "-r${toString manifest.package.packageRevision}";
  licenseMap = {
    "MIT" = lib.licenses.mit;
    "Apache-2.0" = lib.licenses.asl20;
    "SEE LICENSE IN README.md" = lib.licenses.unfree;
  };
  resolvedLicense =
    if builtins.hasAttr manifest.meta.licenseSpdx licenseMap
    then licenseMap.${manifest.meta.licenseSpdx}
    else lib.licenses.unfree;
  aliasOutputs = manifest.binary.aliases or [ ];
  aliasOutputLinks = lib.concatMapStrings (
    alias:
    ''
      mkdir -p "${"$" + alias}/bin"
      cat > "${"$" + alias}/bin/${alias}" <<EOF
#!${lib.getExe bash}
exec "$out/bin/${manifest.binary.name}" "\$@"
EOF
      chmod +x "${"$" + alias}/bin/${alias}"
    ''
  ) aliasOutputs;
  src = fetchFromGitHub {
    owner = "RogerNavelsaker";
    repo = "seeds";
    rev = manifest.package.sourceRev;
    hash = manifest.package.sourceHash;
  };
  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../bun.nix;
  };
  basePackage = bun2nix.mkDerivation {
    pname = manifest.binary.name;
    version = packageVersion;
    inherit src bunDeps;
    module = manifest.binary.entrypoint;
    bunInstallFlags = "--linker=isolated --frozen-lockfile";
    bunCompileToBytecode = false;
    nativeBuildInputs = [ installShellFiles ];
    postPatch = ''
      cp ${../package.json} package.json
      cp ${../bun.lock} bun.lock
      chmod u+w bun.lock package.json
    '';
    postInstall = ''
      mkdir -p "$out/libexec"
      mv "$out/bin/${manifest.binary.name}" "$out/libexec/${manifest.binary.name}"
      mkdir -p "$out/share/${manifest.binary.name}/skill"
      cp ${../skill/SKILL.md} "$out/share/${manifest.binary.name}/skill/SKILL.md"
      cat > "$out/bin/${manifest.binary.name}" <<EOF
#!${lib.getExe bash}
if [ "\$1" = "skill" ]; then
  cat "$out/share/${manifest.binary.name}/skill/SKILL.md"
  exit 0
fi
exec "$out/libexec/${manifest.binary.name}" "\$@"
EOF
      chmod +x "$out/bin/${manifest.binary.name}"
      "$out/bin/${manifest.binary.name}" completions bash > "$TMPDIR/${manifest.binary.name}.bash"
      "$out/bin/${manifest.binary.name}" completions fish > "$TMPDIR/${manifest.binary.name}.fish"
      "$out/bin/${manifest.binary.name}" completions zsh > "$TMPDIR/_${manifest.binary.name}"
      installShellCompletion --cmd ${manifest.binary.name} \
        --bash "$TMPDIR/${manifest.binary.name}.bash" \
        --fish "$TMPDIR/${manifest.binary.name}.fish" \
        --zsh "$TMPDIR/_${manifest.binary.name}"
    '';
    meta = with lib; {
      description = manifest.meta.description;
      homepage = manifest.meta.homepage;
      license = resolvedLicense;
      mainProgram = manifest.binary.name;
      platforms = platforms.linux ++ platforms.darwin;
    };
  };
in
symlinkJoin {
  pname = manifest.binary.name;
  version = packageVersion;
  name = "${manifest.binary.name}-${packageVersion}";
  outputs = [ "out" ] ++ aliasOutputs;
  paths = [ basePackage ];
  postBuild = ''
    ${aliasOutputLinks}
  '';
  meta = basePackage.meta;
}
