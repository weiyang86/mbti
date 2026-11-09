FROM docker.io/library/node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
# runtime/ is ONLY the AF-197 approved, validated runtime bundle; never the repository.
COPY --chown=65534:65534 runtime/ /aij/
USER 65534:65534
WORKDIR /tmp
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/node", "/aij/document-renderer-cli.js"]
