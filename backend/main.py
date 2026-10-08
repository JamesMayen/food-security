from pathlib import Path
import json
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from catboost import CatBoostClassifier
from typing import Optional

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'Train.csv'
SUBMISSION = ROOT / 'data' / 'Final_Submission.csv'
MODELS = ROOT / 'models'
METRICS = ROOT / 'metrics.json'

FEATURES = [
    'state','county','population','start_year','start_month',
    'prior_period_ipc_phase','prior_period_phase3plus_pct',
    'prior_year_cereal_production_tonnes','prior_year_cereal_gap_tonnes'
]
CATEGORICAL = ['state','county','prior_period_ipc_phase']

app = FastAPI(title='South Sudan Food Security Intelligence API', version='1.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://food-security-ss.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

df = pd.read_csv(DATA)
submission = pd.read_csv(SUBMISSION)
metrics = json.loads(METRICS.read_text())
models = []
for seed in (42, 7):
    model = CatBoostClassifier()
    model.load_model(str(MODELS / f'catboost_seed_{seed}.cbm'))
    models.append(model)

# Precompute commonly used data
county_state_map = df.groupby(['state', 'county']).size().reset_index().rename(columns={0: 'count'})
state_stats = df.groupby('state').agg(
    counties=('county', 'nunique'),
    observations=('ID', 'count'),
    risk_rate=('food_insecurity_risk', 'mean'),
    avg_population=('population', 'mean')
).reset_index()
state_stats['risk_rate_pct'] = state_stats['risk_rate'] * 100

# Period trends
period_stats = df.groupby(['start_year', 'start_month']).agg(
    observations=('ID', 'count'),
    counties=('county', 'nunique'),
    ipc3plus_count=('food_insecurity_risk', 'sum'),
    risk_rate=('food_insecurity_risk', 'mean')
).reset_index()
period_stats['period'] = period_stats['start_year'].astype(str) + '-' + period_stats['start_month'].astype(str).str.zfill(2)
period_stats['risk_rate_pct'] = period_stats['risk_rate'] * 100
period_stats = period_stats.sort_values(['start_year', 'start_month'])

# County statistics for atlas/warning
county_stats = df.groupby(['state', 'county']).agg(
    population=('population', 'last'),
    risk_rate=('food_insecurity_risk', 'mean'),
    observations=('ID', 'count'),
    last_ipc=('prior_period_ipc_phase', 'last'),
    last_phase3plus=('prior_period_phase3plus_pct', 'last'),
    last_production=('prior_year_cereal_production_tonnes', 'last'),
    last_gap=('prior_year_cereal_gap_tonnes', 'last'),
    avg_production=('prior_year_cereal_production_tonnes', 'mean'),
    avg_gap=('prior_year_cereal_gap_tonnes', 'mean')
).reset_index()
county_stats['risk_rate_pct'] = county_stats['risk_rate'] * 100
county_stats['priority'] = np.select(
    [county_stats['risk_rate'] >= 0.8, county_stats['risk_rate'] >= 0.5],
    ['CRITICAL', 'PRIORITY'], default='WATCH'
)

# Data quality stats
missing_counts = df.isnull().sum().to_dict()
duplicate_ids = df['ID'].duplicated().sum()
unique_counties = df['county'].nunique()
unique_states = df['state'].nunique()
assessment_periods = df.groupby(['start_year', 'start_month']).ngroups
target_dist = df['food_insecurity_risk'].value_counts().to_dict()

data_quality_status = 'Healthy'
if missing_counts and any(v > 0 for v in missing_counts.values()):
    data_quality_status = 'Review'
if duplicate_ids > 0:
    data_quality_status = 'Warning'

class PredictionRequest(BaseModel):
    state: str
    county: str
    population: float = Field(gt=0)
    start_year: int = Field(ge=2010, le=2100)
    start_month: int = Field(ge=1, le=12)
    prior_period_ipc_phase: str
    prior_period_phase3plus_pct: float = Field(ge=0, le=100)
    prior_year_cereal_production_tonnes: float = Field(ge=0)
    prior_year_cereal_gap_tonnes: float


def make_frame(payload: dict) -> pd.DataFrame:
    return pd.DataFrame([{k: payload[k] for k in FEATURES}])


def risk_band(p: float):
    # Operational visualization bands; competition itself uses continuous probabilities.
    if p < 0.10: return ('Low signal', 'low')
    if p < 0.50: return ('Moderate signal', 'moderate')
    if p < 0.80: return ('High signal', 'high')
    return ('Very high signal', 'critical')

@app.get('/api/health')
def health():
    return {
        'status': 'ok',
        'api': 'connected',
        'model_loaded': len(models) == 2,
        'model': 'CatBoost ensemble',
        'seeds': [42, 7],
        'dataset_loaded': not df.empty,
        'training_rows': int(len(df)),
        'submission_loaded': not submission.empty
    }

@app.get('/api/overview')
def overview():
    return {
        'training_rows': int(len(df)), 'states': int(df.state.nunique()), 'counties': int(df.county.nunique()),
        'periods': int(period_stats.shape[0]), 'positive_rate': float(df.food_insecurity_risk.mean()),
        'validation_auc': metrics['validation_auc'], 'validation_period': metrics['validation_period'],
        'validation_rows': metrics['validation_rows'], 'f1_threshold': metrics['f1_threshold'],
        'f1': metrics['f1'], 'precision': metrics['precision'], 'recall': metrics['recall'],
        'submission_rows': int(len(submission)),
        'submission_min': float(submission.food_insecurity_risk.min()),
        'submission_max': float(submission.food_insecurity_risk.max()),
        'submission_mean': float(submission.food_insecurity_risk.mean()),
    }

@app.get('/api/trends')
def trends():
    return period_stats.to_dict('records')

@app.get('/api/state-summary')
def state_summary(sort_by: str = Query('risk_rate', pattern='^(risk_rate|counties|avg_population)$'), descending: bool = True):
    return state_stats.sort_values(sort_by, ascending=not descending).to_dict('records')

@app.get('/api/options')
def options():
    return {
        'states': sorted(df.state.dropna().unique().tolist()),
        'counties': sorted(df.county.dropna().unique().tolist()),
        'county_state_map': county_stats[['county', 'state']].sort_values(['state', 'county']).to_dict('records'),
        'ipc_phases': sorted(df.prior_period_ipc_phase.dropna().unique().tolist()),
        'years': sorted(df.start_year.dropna().astype(int).unique().tolist()),
    }

@app.post('/api/predict')
def predict(req: PredictionRequest):
    payload = req.model_dump()
    X = make_frame(payload)
    probs = [float(m.predict_proba(X)[:,1][0]) for m in models]
    p = float(np.mean(probs))
    band, key = risk_band(p)
    return {
        'probability': p, 'probability_pct': p*100, 'band': band, 'band_key': key,
        'model_predictions': {'seed_42': probs[0], 'seed_7': probs[1]},
        'f1_threshold': metrics['f1_threshold'],
        'above_operational_threshold': p >= metrics['f1_threshold'],
        'note': 'This is an early-warning signal, not an IPC classification or humanitarian eligibility decision.'
    }

@app.get('/api/counties')
def counties(state: str | None = None, search: str | None = None):
    result = county_stats
    if state and state != 'All': result = result[result.state == state]
    if search: result = result[result.county.str.contains(search, case=False, na=False)]
    return result.sort_values('risk_rate', ascending=False).to_dict('records')

@app.get('/api/history/{county}')
def history(county: str):
    d = df[df.county == county].copy().sort_values(['start_year','start_month'])
    if d.empty: raise HTTPException(404, 'County not found')
    rows = []
    for _, r in d.iterrows():
        rows.append({
            'period': f"{int(r.start_year)}-{int(r.start_month):02d}",
            'year': int(r.start_year), 'month': int(r.start_month),
            'target': int(r.food_insecurity_risk), 'ipc': r.prior_period_ipc_phase,
            'phase3plus_pct': float(r.prior_period_phase3plus_pct),
            'production': float(r.prior_year_cereal_production_tonnes),
            'gap': float(r.prior_year_cereal_gap_tonnes), 'population': float(r.population)
        })
    return {'county': county, 'state': d.state.iloc[-1], 'rows': rows}

@app.get('/api/feature-importance')
def feature_importance():
    importance = np.mean([m.get_feature_importance() for m in models], axis=0)
    return sorted(
        [{'feature': feature, 'importance': float(value)} for feature, value in zip(FEATURES, importance)],
        key=lambda item: item['importance'], reverse=True
    )

@app.get('/api/risk-distribution')
def risk_distribution():
    values = submission.food_insecurity_risk.to_numpy()
    counts, edges = np.histogram(values, bins=10)
    return [{'range_start': float(edges[i]), 'range_end': float(edges[i + 1]), 'count': int(counts[i])} for i in range(len(counts))]

@app.get('/api/data-quality')
def data_quality():
    return {
        'status': data_quality_status,
        'rows': int(len(df)),
        'columns': int(len(df.columns)),
        'missing_values': int(df.isnull().sum().sum()),
        'missing_by_column': {key: int(value) for key, value in missing_counts.items()},
        'duplicate_ids': int(duplicate_ids),
        'unique_counties': int(unique_counties),
        'unique_states': int(unique_states),
        'assessment_periods': int(assessment_periods),
        'target_distribution': {str(key): int(value) for key, value in target_dist.items()}
    }

@app.get('/api/alerts')
def alerts():
    latest = df.sort_values(['start_year', 'start_month']).groupby(['state', 'county'], as_index=False).tail(1).copy()
    scores = np.mean([model.predict_proba(latest[FEATURES])[:, 1] for model in models], axis=0)
    latest['risk_probability'] = scores
    latest['priority'] = np.select([scores >= 0.8, scores >= 0.5], ['CRITICAL', 'PRIORITY'], default='WATCH')
    latest['signal_reason'] = np.select(
        [latest.prior_period_phase3plus_pct >= 50, latest.prior_period_ipc_phase == 'Emergency'],
        ['High previous Phase 3+ prevalence', 'Previous IPC phase = Emergency'],
        default='Historical model signal from latest available county record'
    )
    columns = ['state', 'county', 'risk_probability', 'prior_period_ipc_phase', 'prior_period_phase3plus_pct', 'population', 'priority', 'signal_reason']
    return latest[columns].sort_values('risk_probability', ascending=False).to_dict('records')

@app.get('/api/submission')
def submission_data():
    s = submission.copy()
    s['probability_pct'] = s.food_insecurity_risk * 100
    s['rank_within_submission'] = s.food_insecurity_risk.rank(method='min', ascending=False).astype(int)
    return {
        'rows': s.to_dict('records'),
        'summary': {
            'count': len(s),
            'min': float(s.food_insecurity_risk.min()),
            'max': float(s.food_insecurity_risk.max()),
            'mean': float(s.food_insecurity_risk.mean()),
            'median': float(s.food_insecurity_risk.median()),
            'std': float(s.food_insecurity_risk.std())
        }
    }

# Production frontend calls these paths without the /api prefix.
for _route in [r for r in app.routes if getattr(r, 'path', '').startswith('/api/')]:
    app.add_api_route(_route.path[len('/api'):], _route.endpoint, methods=list(_route.methods), include_in_schema=False)
