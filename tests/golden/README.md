# Golden Tests

Regressão pra evitar que corrigir uma coisa quebre outra.

## Estrutura

```
tests/golden/
├── fixtures/                        # JSON de fixtures (transcrição + esperado)
│   └── whatsapp-video-38s.json
├── run-golden.mjs                   # runner (Node, sem dependência extra)
└── README.md
```

## Formato de fixture

```json
{
  "name": "whatsapp-video-38s",
  "description": "Vídeo real do Uelvison, 38s, com repetições, enumeração, hesitação inicial",
  "durationSec": 38.095,
  "profile": "equilibrada",
  "words": [
    { "word": "Bom,", "start": 2.52, "end": 3.32 },
    { "word": "na", "start": 3.84, "end": 3.88 }
    // ...
  ],
  "waveform": [],
  "semantic": null,
  "expected": [
    { "startApprox": 0,    "endApprox": 2.3,  "expected": "REMOVE", "reason": "no_speech" },
    { "startApprox": 3.84, "endApprox": 5.0,  "expected": "REMOVE", "reason": "stutter" },
    { "startApprox": 14.0, "endApprox": 17.0, "expected": "REMOVE", "reason": "silence" },
    { "startApprox": 18.0, "endApprox": 22.0, "expected": "KEEP",   "reason": "enumeration" },
    { "startApprox": 23.5, "endApprox": 27.0, "expected": "REMOVE", "reason": "abandoned_phrase" }
  ]
}
```

- `startApprox`/`endApprox`: instantes aproximados (tolerância padrão ±0.5s)
- `expected`: `REMOVE` | `KEEP` | `REVIEW`
- `reason`: pra facilitar debug, não é checado

## Rodar

```bash
node tests/golden/run-golden.mjs
```

## Métricas reportadas

- **TP** (true positive): esperava REMOVE e detectou REMOVE
- **FP** (false positive): esperava KEEP mas removeu (grave — destrói fala)
- **FN** (false negative): esperava REMOVE mas deixou (leve — usuário pode marcar)
- **Match**: TP dividido por total esperado

Meta:
- **FP = 0** (nunca cortar conteúdo bom)
- **Match ≥ 80%** (pegar a maioria dos erros)

## Adicionar fixture

1. Roda o vídeo no editor com `?debug=1`
2. Exporta diagnóstico
3. Copia `words[]`, `duration`, e escreve `expected[]` manualmente
4. Salva em `tests/golden/fixtures/`
5. Roda `node tests/golden/run-golden.mjs`
