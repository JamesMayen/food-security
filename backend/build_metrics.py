import json
from pathlib import Path
import numpy as np, pandas as pd
from catboost import CatBoostClassifier
from sklearn.metrics import roc_auc_score, f1_score, precision_score, recall_score
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data/Train.csv'
FEATURES=['state','county','population','start_year','start_month','prior_period_ipc_phase','prior_period_phase3plus_pct','prior_year_cereal_production_tonnes','prior_year_cereal_gap_tonnes']
CAT=['state','county','prior_period_ipc_phase']
df=pd.read_csv(DATA)
df['_date']=pd.to_datetime(dict(year=df.start_year,month=df.start_month,day=1))
latest=df['_date'].max(); tr=df[df['_date']<latest]; va=df[df['_date']==latest]
val=[]
full=[]
for seed in [42,7]:
    m=CatBoostClassifier(iterations=1800,depth=7,learning_rate=.02,l2_leaf_reg=6,loss_function='Logloss',eval_metric='AUC',random_seed=seed,verbose=False,allow_writing_files=False,thread_count=-1)
    m.fit(tr[FEATURES],tr.food_insecurity_risk,cat_features=CAT)
    val.append(m.predict_proba(va[FEATURES])[:,1])
    m2=CatBoostClassifier(iterations=1800,depth=7,learning_rate=.02,l2_leaf_reg=6,loss_function='Logloss',eval_metric='AUC',random_seed=seed,verbose=False,allow_writing_files=False,thread_count=-1)
    m2.fit(df[FEATURES],df.food_insecurity_risk,cat_features=CAT)
    full.append(m2)
p=np.mean(val,axis=0)
y=va.food_insecurity_risk.to_numpy()
auc=roc_auc_score(y,p)
best=(0,0,0,0)
for t in np.linspace(0.01,0.99,99):
    f=f1_score(y,p>=t)
    if f>best[1]: best=(float(t),float(f),float(precision_score(y,p>=t)),float(recall_score(y,p>=t)))
imp=np.mean([m.get_feature_importance() for m in full],axis=0)
metrics={
 'validation_period':latest.strftime('%Y-%m'), 'validation_rows':int(len(va)), 'validation_auc':float(auc),
 'f1_threshold':best[0], 'f1':best[1], 'precision':best[2], 'recall':best[3],
 'feature_importance':dict(sorted({f:float(v) for f,v in zip(FEATURES,imp)}.items(), key=lambda kv: kv[1], reverse=True)),
 'training_rows':int(len(df)), 'states':int(df.state.nunique()), 'counties':int(df.county.nunique()),
 'positive_rate':float(df.food_insecurity_risk.mean()), 'periods':int(df['_date'].nunique())
}
(ROOT/'metrics.json').write_text(json.dumps(metrics,indent=2))
print(json.dumps(metrics,indent=2))
