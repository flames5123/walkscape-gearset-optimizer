FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies including git
RUN apt-get update && apt-get install -y \
    gcc \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY ui/requirements.txt /app/ui/requirements.txt
RUN pip install --no-cache-dir -r ui/requirements.txt

# Copy the entire project (needed for util imports)
COPY . /app/

# Create cache directories
RUN mkdir -p /app/util/cache && \
    chmod -R 755 /app/util/cache

# Expose port 6969
EXPOSE 6969

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Run the FastAPI app with uvicorn
CMD ["uvicorn", "ui.app:app", "--host", "0.0.0.0", "--port", "6969"]
