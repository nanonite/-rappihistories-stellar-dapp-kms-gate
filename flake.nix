{
  description = "Medichain KMS gate MVP toolchain";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    medichain-packages.url = "git+file:../packages?ref=main&rev=83f5733b41c285c14944ee90102b96bc70767127";
  };

  outputs =
    { nixpkgs
    , medichain-packages
    , ...
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      pkgsFor = system:
        import nixpkgs {
          inherit system;
        };

      kmsGateShellFor = system:
        let
          pkgs = pkgsFor system;
        in
        pkgs.mkShell {
          name = "medichain-kms-gate";

          packages = with pkgs; [
            bashInteractive
            bun
            cacert
            curl
            git
            jq
            just
            nodejs_22
            openssl
            typescript
          ];

          STELLAR_RPC_URL = "http://localhost:8000/soroban/rpc";
          BROKER_CONTRACT_ID = "";
          KMS_GATE_PORT = "8787";

          shellHook = ''
            echo "Medichain KMS gate: Node $(node --version), Bun $(bun --version), TypeScript $(tsc --version | cut -d' ' -f2)"
            echo "MVP env: STELLAR_RPC_URL=$STELLAR_RPC_URL KMS_GATE_PORT=$KMS_GATE_PORT"
          '';
        };

      installDomainPackage = ''
        cp -R "$domain_src" ./domain
        chmod -R u+w ./domain
        (cd ./domain && tsc -b --pretty false)

        mkdir -p ./kms-gate/node_modules/@medichain/domain
        cp -R ./domain/dist ./kms-gate/node_modules/@medichain/domain/dist
        cat > ./kms-gate/node_modules/@medichain/domain/package.json <<'JSON'
        {
          "name": "@medichain/domain",
          "version": "0.1.0",
          "private": true,
          "type": "module",
          "main": "./dist/index.js",
          "types": "./dist/index.d.ts",
          "exports": {
            ".": {
              "types": "./dist/index.d.ts",
              "default": "./dist/index.js"
            }
          }
        }
        JSON
      '';
    in
    {
      devShells = forAllSystems
        (system: {
          default = kmsGateShellFor system;
          ci = kmsGateShellFor system;
        });

      checks = forAllSystems
        (system:
          let
            pkgs = pkgsFor system;
          in
          {
            kms-gate-mvp = pkgs.runCommand "medichain-kms-gate-mvp"
              {
                nativeBuildInputs = [
                  pkgs.bun
                  pkgs.coreutils
                  pkgs.gnugrep
                  pkgs.typescript
                ];
                src = ./.;
                domain_src = "${medichain-packages}/domain";
              } ''
              cp -R "$src" ./kms-gate
              chmod -R u+w ./kms-gate

              ${installDomainPackage}

              cd ./kms-gate
              tsc -b --pretty false
              bun test src/test-vectors/conformance.test.ts

              if [ -f src/predicate/ReleasePredicateEvaluator.ts ]; then
                grep -q 'from "@medichain/domain"' src/predicate/ReleasePredicateEvaluator.ts
              fi

              if [ -d src ]; then
                ! grep -R "simulateTransaction" src
              fi

              mkdir -p "$out"
            '';
          });

      formatter = forAllSystems (system: (pkgsFor system).nixpkgs-fmt);
    };
}
