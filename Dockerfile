# AKS Dashboard — Image Docker
# Build : docker build -t aks-dashboard .
# Run   : docker run -p 5000:5000 -v ~/.kube:/root/.kube aks-dashboard

FROM python:3.11-slim

WORKDIR /app

# Installer kubectl dans l'image
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && mv kubectl /usr/local/bin/ && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Installer les dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code de l'application
COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
