# Optional: Use this if you need more control over the container
# Uncomment the devcontainer.json "build" section and comment out "image" to use this

FROM mcr.microsoft.com/devcontainers/python:3.11

# Install additional system dependencies if needed
# RUN apt-get update && apt-get install -y \
#     some-package \
#     && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create cache directories with proper permissions
RUN mkdir -p /workspace/util/cache && \
    chown -R vscode:vscode /workspace
