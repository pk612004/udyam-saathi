.PHONY: data test serve demo
data:            ## rebuild every asset the app uses from data/
	python analysis/build_assets.py
	python model/propensity.py && cp model/metrics.json web/data/
	python kyc/ocr_extract.py
	python kyc/validators.py
test:            ## Python + browser-logic tests
	python -m pytest tests/ -q
	node tests/kyc_parity.mjs
	node tests/engine.test.mjs
serve:           ## full app with API (set LLM_API_KEY to turn on the AI advisor)
	python server/app.py
demo:            ## static only, no API
	cd web && python -m http.server 8000
