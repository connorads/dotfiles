          `@hyperframes/core does not export ./${subpath}\n` +
            `  found at: ${pkgPath} (version ${pkg.version})\n` +
            `  install with quarantine and scripts protection intact: pnpm add -D --save-exact @hyperframes/core@0.8.46`,
        );
      }
