# Pure HTTP actor. The standard Node 22 runtime is enough.
FROM apify/actor-node:22

# Copy just the package files first to keep the dependency layer cached.
COPY --chown=myuser:myuser package*.json Dockerfile ./

# Install production dependencies and fail the build if impit's native binary
# is missing for this platform.
RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && node -e "import('impit').then((m) => console.log('impit OK:', Object.keys(m)))" \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -rf ~/.npm

# Copy the remaining source after the dependency layer.
COPY --chown=myuser:myuser . ./

CMD ["node", "src/main.js"]
