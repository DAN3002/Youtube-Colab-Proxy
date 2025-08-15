# youtube-colab-proxy

A minimal Python package scaffold.

## Install (from source)

```bash
pip install -e .
```

This exposes a CLI:

```bash
ycp
```

## Development

- Create venv and install dev tools:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip setuptools wheel build pytest
pip install -e .
```

- Run tests:

```bash
pytest -q
```

## Build

```bash
python -m build
```

Artifacts are created under `dist/`.

## Publish

- Install Twine and upload:

```bash
pip install twine
python -m build
twine upload dist/*
```

Replace the homepage/repo URLs in `pyproject.toml`.
