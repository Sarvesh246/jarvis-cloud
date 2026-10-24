"""Check weather reference storage as the production container's runtime user."""

import json

try:
    from weather import keep, read_forecast, folder, REFERENCE
except ImportError:
    from cloud.weather import keep, read_forecast, folder, REFERENCE


def main():
    payload = '```weather\n' + json.dumps({'version': 1, 'title': 'Runtime check'}) + '\n```'
    reference = keep(payload)
    token = REFERENCE.fullmatch(reference)[1]
    try:
        if read_forecast(token) != payload:
            raise RuntimeError('Weather cache did not preserve its provider payload')
    finally:
        (folder() / (token + '.txt')).unlink(missing_ok=True)
    print('Weather reference cache write/read passed')


if __name__ == '__main__':
    main()
