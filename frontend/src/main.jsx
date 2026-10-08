import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity, AlertTriangle, BarChart3, Check, ChevronDown, ChevronRight, CircleHelp, Database, Download, FileText, Gauge, Map, Menu, Search, ShieldCheck, Target, TrendingUp, Users, X} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import './styles.css';
import { predictFoodSecurity } from "../services/api";

const result = await predictFoodSecurity(formData);

const API = `${(import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/$/, '')}`;
const NAV = [
  ['dashboard', 'Dashboard', Gauge], ['predictor', 'Risk Predictor', Target],
  ['counties', 'County Intelligence', Search], ['atlas', 'Risk Atlas', Map],
  ['warning', 'Early Warning', AlertTriangle], ['submission', 'Submission Analytics', BarChart3],
  ['method', 'Model & Methodology', ShieldCheck], ['about', 'About', CircleHelp]
];
const FEATURE_LABELS = ['state', 'county', 'population', 'start_year', 'start_month', 'prior_period_ipc_phase', 'prior_period_phase3plus_pct', 'prior_year_cereal_production_tonnes', 'prior_year_cereal_gap_tonnes'];
const INITIAL_FORM = {state:'', county:'', population:'', start_year:'2025', start_month:'4', prior_period_ipc_phase:'', prior_period_phase3plus_pct:'', prior_year_cereal_production_tonnes:'', prior_year_cereal_gap_tonnes:''};

async function get(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
async function post(path, body) {
  const response = await fetch(`${API}${path}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const fmt = value => hasNumber(value) ? new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(Number(value)) : 'Data unavailable';
const pct = value => hasNumber(value) ? `${(Number(value) * 100).toFixed(1)}%` : 'Data unavailable';
const pctValue = value => hasNumber(value) ? `${Number(value).toFixed(1)}%` : 'Data unavailable';
const pretty = value => String(value || '').replaceAll('_',' ').replace('pct','%').replace(/\b\w/g, letter => letter.toUpperCase()).replace('Ipc','IPC').replace('3Plus','3+');

function downloadCsv(filename, rows, columns) {
  if (!rows?.length) return;
  const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const csv = [columns.map(([,label]) => quote(label)).join(','), ...rows.map(row => columns.map(([key]) => quote(row[key])).join(','))].join('\r\n');
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [retryKey, setRetryKey] = useState(0);
  const [healthLoading, setHealthLoading] = useState(true);
  const [countyQuery, setCountyQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('All');
  const [riskFilter, setRiskFilter] = useState('All');
  const [stateSort, setStateSort] = useState('risk_rate');
  const [countySort, setCountySort] = useState('risk_rate');
  const [submissionSort, setSubmissionSort] = useState('probability');
  const [selectedCounty, setSelectedCounty] = useState('');
  const [countyHistory, setCountyHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [form, setForm] = useState(INITIAL_FORM);
  const [prediction, setPrediction] = useState(null);
  const [predictionError, setPredictionError] = useState('');
  const [predicting, setPredicting] = useState(false);

  useEffect(() => {
    let active = true;
    const endpoints = {
      health:'/health', overview:'/overview', options:'/options', trends:'/trends', states:'/state-summary',
      counties:'/counties', features:'/feature-importance', submission:'/submission', distribution:'/risk-distribution',
      quality:'/data-quality', alerts:'/alerts'
    };
    setHealthLoading(true);
    Promise.all(Object.entries(endpoints).map(async ([key, path]) => {
      try { return [key, await get(path), '']; }
      catch (error) { return [key, null, error.message || 'Unable to load data']; }
    })).then(results => {
      if (!active) return;
      const nextData = {}, nextErrors = {};
      results.forEach(([key, value, error]) => { nextData[key] = value; if (error) nextErrors[key] = error; });
      setData(nextData);
      setErrors(nextErrors);
      setHealthLoading(false);
      if (nextData.options?.county_state_map?.length) {
        const first = nextData.counties?.[0];
        const firstLocation = first || nextData.options.county_state_map[0];
        const matching = nextData.counties?.find(row => row.county === firstLocation.county && row.state === firstLocation.state);
        setForm(current => current.state ? current : ({...current, state:firstLocation.state, county:firstLocation.county,
          population:matching?.population ?? '', prior_period_ipc_phase:matching?.last_ipc ?? nextData.options.ipc_phases?.[0] ?? '',
          prior_period_phase3plus_pct:matching?.last_phase3plus ?? '', prior_year_cereal_production_tonnes:matching?.last_production ?? '',
          prior_year_cereal_gap_tonnes:matching?.last_gap ?? ''}));
      }
    });
    return () => {active = false;};
  }, [retryKey]);

  useEffect(() => {
    if (!selectedCounty) { setCountyHistory(null); return; }
    let active = true;
    setHistoryError('');
    get(`/history/${encodeURIComponent(selectedCounty)}`).then(result => {if (active) setCountyHistory(result);})
      .catch(error => {if (active) {setCountyHistory(null); setHistoryError(error.message || 'Unable to load county history.');}});
    return () => {active = false;};
  }, [selectedCounty]);

  const runPrediction = async event => {
    event.preventDefault();
    setPredictionError('');
    setPrediction(null);
    setPredicting(true);
    try {
      const body = {...form};
      ['population','start_year','start_month','prior_period_phase3plus_pct','prior_year_cereal_production_tonnes','prior_year_cereal_gap_tonnes'].forEach(key => {body[key] = Number(body[key]);});
      setPrediction(await post('/predict', body));
    } catch (error) {
      setPredictionError(error.message || 'Prediction request failed.');
    } finally { setPredicting(false); }
  };

  const countyRows = (data.counties || []).filter(row => (stateFilter === 'All' || row.state === stateFilter)
    && row.county.toLowerCase().includes(countyQuery.toLowerCase())
    && (riskFilter === 'All' || row.priority === riskFilter))
    .sort((a,b) => countySort === 'population' ? b.population - a.population : countySort === 'observations' ? b.observations-a.observations : b.risk_rate-a.risk_rate);
  const dashboardCounties = [...(data.counties || [])].sort((a,b) => b.risk_rate-a.risk_rate);
  const states = [...(data.states || [])].sort((a,b) => stateSort === 'counties' ? b.counties-a.counties : stateSort === 'avg_population' ? b.avg_population-a.avg_population : stateSort === 'lowest_risk' ? a.risk_rate-b.risk_rate : b.risk_rate-a.risk_rate);
  const submissionRows = [...(data.submission?.rows || [])].sort((a,b) => submissionSort === 'id' ? String(a.ID).localeCompare(String(b.ID)) : b.food_insecurity_risk-a.food_insecurity_risk);

  const briefHtml = () => {
    const overview = data.overview;
    if (!overview) return;
    const priority = dashboardCounties.slice(0,8).map(row => `<li>${row.county}, ${row.state}: ${pct(row.risk_rate)} historical IPC 3+ rate</li>`).join('');
    const stateSummary = states.slice(0,5).map(row => `<li>${row.state}: ${pct(row.risk_rate)} historical rate across ${row.counties} counties</li>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>South Sudan analytical brief</title><style>body{font:16px/1.55 Georgia,serif;max-width:850px;margin:48px auto;color:#172328}h1,h2{font-family:Arial,sans-serif}small{color:#64716f}.notice{border-left:4px solid #167d69;padding:12px;background:#edf5f1}</style></head><body><small>MODEL-GENERATED ANALYTICAL BRIEF · NOT AN OFFICIAL SITUATION REPORT</small><h1>South Sudan Food Security</h1><p>Data-derived summary for ${overview.periods} assessment periods in the training dataset.</p><h2>1. National overview</h2><p>${fmt(overview.training_rows)} training observations across ${overview.counties} counties and ${overview.states} states. Observed IPC 3+ target prevalence: ${pct(overview.positive_rate)}.</p><h2>2. Highest-priority counties</h2><ul>${priority || '<li>Data unavailable</li>'}</ul><h2>3. State observations</h2><ul>${stateSummary || '<li>Data unavailable</li>'}</ul><h2>4. Emerging signals</h2><p>Latest available county records scored by the two-seed CatBoost ensemble; signals are sorted by model probability. Review with field evidence.</p><h2>5. Model information</h2><p>CatBoost ensemble, seeds 42 and 7. Chronological validation ROC-AUC: ${Number(overview.validation_auc).toFixed(4)}.</p><h2>6. Recommended analytical follow-up</h2><p>Verify recent conditions with local partners, assess data freshness, and triangulate with IPC and field assessments.</p><h2>7. Limitations</h2><p class="notice">This experimental model is a decision-support and early-warning tool. It does not replace IPC analysis, expert assessment, field verification, humanitarian coordination, or aid eligibility decisions.</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], {type:'text/html'}));
    const link = document.createElement('a'); link.href = url; link.download = 'south-sudan-model-analytical-brief.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const title = NAV.find(item => item[0] === page)?.[1] || 'Dashboard';
  const currentHealth = data.health;
  return <div className="appShell">
    {drawerOpen && <button className="drawerScrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}
    <aside className={`sidebar ${drawerOpen ? 'drawerOpen' : ''}`}>
      <div className="brand"><div className="brandMark"><Activity size={20}/></div><div><b>SOUTH SUDAN</b><span>FOOD SECURITY<br/>INTELLIGENCE</span></div><button className="iconButton drawerClose" onClick={() => setDrawerOpen(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="sideCaption">INTELLIGENCE PLATFORM</div>
      <nav aria-label="Main navigation">{NAV.map(([id,label,Icon]) => <button key={id} className={page === id ? 'navItem active' : 'navItem'} onClick={() => {setPage(id); setDrawerOpen(false);}} aria-current={page === id ? 'page' : undefined}><Icon size={17}/><span>{label}</span>{page === id && <ChevronRight size={14} className="navArrow"/>}</button>)}</nav>
      <div className="sidebarFoot"><Status health={currentHealth} loading={healthLoading}/><span className="muted">CatBoost · two-seed ensemble</span></div>
    </aside>
    <main className="mainArea">
      <header className="topbar"><div className="topTitle"><button className="iconButton menuButton" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Menu size={20}/></button><div><span className="eyebrow">HUMANITARIAN EARLY-WARNING &amp; DECISION SUPPORT</span><h1>{title}</h1></div></div><div className="healthSummary"><Status health={currentHealth} loading={healthLoading}/><button className="iconButton refreshButton" aria-label="Retry backend connection" title="Retry backend connection" onClick={() => setRetryKey(value => value+1)}><Activity size={16}/></button></div></header>
      {!currentHealth && !healthLoading && <div className="backendBanner" role="alert"><AlertTriangle size={17}/><span><b>Backend unavailable.</b> Please start the FastAPI server and try again.</span><button className="secondaryButton" onClick={() => setRetryKey(value => value+1)}>Retry</button></div>}
      {errors[page === 'dashboard' ? 'overview' : page === 'predictor' ? 'options' : page === 'counties' || page === 'atlas' ? 'counties' : page === 'warning' ? 'alerts' : page === 'submission' ? 'submission' : page === 'method' ? 'features' : 'health'] && <ApiError message="Unable to load this section's data." onRetry={() => setRetryKey(value => value+1)}/>}
      {page === 'dashboard' && <Dashboard data={data} states={states} counties={dashboardCounties} stateSort={stateSort} setStateSort={setStateSort} errors={errors} onGo={setPage} onCounty={setSelectedCounty} onBrief={briefHtml}/>}
      {page === 'predictor' && <Predictor data={data} form={form} setForm={setForm} onPredict={runPrediction} loading={predicting} prediction={prediction} error={predictionError}/>}
      {page === 'counties' && <CountyIntelligence data={data} rows={countyRows} query={countyQuery} setQuery={setCountyQuery} state={stateFilter} setState={setStateFilter} risk={riskFilter} setRisk={setRiskFilter} sort={countySort} setSort={setCountySort} selected={selectedCounty} setSelected={setSelectedCounty} history={countyHistory} historyError={historyError}/>}
      {page === 'atlas' && <Atlas rows={data.counties || []} states={data.options?.states || []} setCounty={setSelectedCounty} onGo={setPage}/>}
      {page === 'warning' && <EarlyWarning data={data} onGo={setPage} onCounty={setSelectedCounty}/>}
      {page === 'submission' && <Submission data={data} rows={submissionRows} sort={submissionSort} setSort={setSubmissionSort}/>}
      {page === 'method' && <Methodology data={data} onQuality={() => setPage('method')}/>}
      {page === 'about' && <About/>}
      <footer className="pageFooter"><span>Experimental analytical decision support · Data from the project training dataset</span><span>Not an official IPC classification</span></footer>
    </main>
  </div>;
}

function Status({health, loading}) {
  if (loading) return <span className="statusLine"><i className="statusDot pending"/>Checking API</span>;
  if (!health) return <span className="statusLine"><i className="statusDot down"/>Backend unavailable</span>;
  return <div className="statusGroup"><span className="statusLine"><i className="statusDot up"/>API connected</span><span className="statusLine"><i className={`statusDot ${health.model_loaded ? 'up' : 'down'}`}/>{health.model_loaded ? 'Model loaded' : 'Model unavailable'}</span><span className="statusLine"><i className={`statusDot ${health.dataset_loaded ? 'up' : 'down'}`}/>{health.dataset_loaded ? 'Dataset loaded' : 'Dataset unavailable'}</span></div>;
}
function PageIntro({eyebrow, title, description, action}) {return <div className="pageIntro"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;}
function ApiError({message, onRetry}) {return <div className="apiError" role="alert"><AlertTriangle size={18}/><span>{message} Data unavailable until the API responds.</span><button className="secondaryButton" onClick={onRetry}>Retry</button></div>;}
function EmptyState({children}) {return <div className="emptyState"><Database size={20}/><span>{children}</span></div>;}
function Kpi({label,value,detail,icon:Icon}) {return <section className="kpi"><div className="kpiTop"><span>{label}</span><Icon size={17}/></div><strong>{value ?? 'Data unavailable'}</strong><small>{detail}</small></section>;}
function Panel({eyebrow,title,action,children,className=''}) {return <section className={`panel ${className}`}><div className="panelHead"><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div>{action}</div>{children}</section>;}
function Priority({value}) {return <span className={`priority ${String(value || 'WATCH').toLowerCase()}`}><i/>{value || 'WATCH'}</span>;}

function Dashboard({data,states,counties,stateSort,setStateSort,errors,onGo,onCounty,onBrief}) {
  const overview=data.overview, trend=data.trends || [], alerts=data.alerts || [];
  return <div className="pageContent">
    <section className="dashboardBanner"><div><span className="liveFlag"><i/> NATIONAL COMMAND CENTER</span><h2>Food security<br/><em>intelligence</em></h2><p>Historical evidence, predictive signals, and county-level context for analytical review across South Sudan.</p><div className="bannerActions"><button className="primaryButton" onClick={() => onGo('predictor')}>Run a risk assessment <ChevronRight size={16}/></button><button className="secondaryButton" onClick={onBrief}><FileText size={15}/>Generate situation brief</button></div></div><div className="bannerMeta"><div className="metaLabel">CHRONOLOGICAL VALIDATION</div><strong>{overview ? overview.validation_auc.toFixed(4) : '—'}</strong><span>ROC-AUC · {overview?.validation_period || 'Data unavailable'}</span><div className="metaRule"/><small>Two-seed CatBoost ensemble<br/>42 + 7</small></div></section>
    {errors.overview ? <ApiError message="Unable to load national overview." onRetry={() => location.reload()}/> : <div className="kpiGrid"><Kpi icon={Map} label="Historical counties" value={overview?.counties} detail={`${overview?.states ?? '—'} states represented`}/><Kpi icon={Database} label="Training observations" value={fmt(overview?.training_rows)} detail={`${overview?.periods ?? '—'} assessment periods`}/><Kpi icon={AlertTriangle} label="Historical IPC 3+ rate" value={pct(overview?.positive_rate)} detail="Observed training target prevalence"/><Kpi icon={Gauge} label="Validation AUC" value={overview?.validation_auc?.toFixed(4)} detail={`${overview?.validation_rows ?? '—'} records · ${overview?.validation_period ?? '—'}`}/></div>}
    <div className="contentGrid trendGrid"><Panel eyebrow="NATIONAL FOOD SECURITY TREND" title="Historical IPC 3+ rate" className="trendPanel"><div className="chartBox"><ResponsiveContainer width="100%" height={285}><LineChart data={trend} margin={{top:10,right:14,left:0,bottom:5}}><CartesianGrid stroke="#263640" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="period" tick={{fill:'#819197',fontSize:10}} tickLine={false} axisLine={false} minTickGap={22}/><YAxis domain={[0,100]} tickFormatter={value => `${value}%`} tick={{fill:'#819197',fontSize:10}} tickLine={false} axisLine={false}/><Tooltip content={<TrendTooltip/>}/><Line type="monotone" dataKey="risk_rate_pct" name="IPC 3+ rate" stroke="#74d3b0" strokeWidth={2.5} dot={false} activeDot={{r:4}}/></LineChart></ResponsiveContainer></div><div className="chartFoot">Assessment periods are aggregated from observed county records; this is historical prevalence, not a forecast.</div></Panel>
      <Panel eyebrow="STATE RISK PROFILE" title="Historical state comparison" action={<label className="compactSelect"><span className="srOnly">Sort states</span><select value={stateSort} onChange={event=>setStateSort(event.target.value)} aria-label="Sort state profile"><option value="risk_rate">Highest risk</option><option value="lowest_risk">Lowest risk</option><option value="counties">County count</option><option value="avg_population">Population</option></select></label>}>
        <StateBars states={states.slice(0,9)}/>
      </Panel>
    </div>
    <div className="contentGrid lowerGrid"><Panel eyebrow="ANALYTICAL PRIORITY" title="County watchlist" action={<button className="textAction" onClick={() => onGo('counties')}>All county intelligence <ChevronRight size={14}/></button>}>
      <div className="tableScroll"><table><thead><tr><th>County / State</th><th>Historical 3+ rate</th><th>Previous IPC</th><th>Population</th><th>Priority</th></tr></thead><tbody>{counties.slice(0,6).map(row=><tr key={`${row.state}-${row.county}`}><td><b>{row.county}</b><small>{row.state}</small></td><td>{pct(row.risk_rate)}</td><td>{row.last_ipc} · {pctValue(row.last_phase3plus)}</td><td>{fmt(row.population)}</td><td><Priority value={row.priority}/></td></tr>)}</tbody></table></div><p className="disclaimerText">Priority categories are dashboard-derived analytical groupings, not official IPC classifications.</p>
    </Panel><Panel eyebrow="LIVE ANALYTICAL SIGNALS" title="Latest county model signals" action={<button className="textAction" onClick={() => onGo('warning')}>Open watchlist <ChevronRight size={14}/></button>}>
      {alerts.length ? <div className="signalRows">{alerts.slice(0,5).map(row=><button className="signalRow" key={`${row.state}-${row.county}`} onClick={() => {onCounty(row.county);onGo('counties');}}><span className="signalIcon"><AlertTriangle size={15}/></span><span className="signalCounty"><b>{row.county}</b><small>{row.state} · {row.signal_reason}</small></span><strong>{pct(row.risk_probability)}</strong></button>)}</div> : <EmptyState>Alert data unavailable</EmptyState>}
    </Panel></div>
    <ResponsibleNote/>
  </div>;
}
function TrendTooltip({active,payload,label}) {if (!active || !payload?.length) return null; const row=payload[0].payload; return <div className="chartTooltip"><b>{label}</b><span>IPC 3+ rate: {pctValue(row.risk_rate_pct)}</span><span>Observations: {fmt(row.observations)}</span><span>IPC 3+ count: {fmt(row.ipc3plus_count)}</span></div>;}
function StateBars({states}) {return <div className="stateBars">{states.length ? states.map(row=><div className="stateBar" key={row.state}><div className="stateBarLabel"><b>{row.state}</b><span>{pct(row.risk_rate)}</span></div><div className="barTrack"><i style={{width:`${Math.max(0,Math.min(100,row.risk_rate*100))}%`}}/></div><small>{row.counties} counties · avg pop. {fmt(row.avg_population)}</small></div>) : <EmptyState>State summary unavailable</EmptyState>}</div>;}
function ResponsibleNote() {return <div className="responsibleNote"><ShieldCheck size={17}/><p><b>Responsible use:</b> This model is a decision-support and early-warning tool. It does not replace IPC analysis, expert assessment, field verification or humanitarian coordination.</p></div>;}

function Predictor({data,form,setForm,onPredict,loading,prediction,error}) {
  const options=data.options, states=options?.states || [];
  const countyChoices=(options?.county_state_map || []).filter(item => item.state === form.state);
  const selectedRecord=(data.counties || []).find(row => row.state === form.state && row.county === form.county);
  const setField=(key,value)=>setForm(current=>({...current,[key]:value}));
  const changeCounty=county=>{const record=(data.counties || []).find(row=>row.state===form.state && row.county===county); setForm(current=>({...current,county,...(record ? {population:record.population,prior_period_ipc_phase:record.last_ipc,prior_period_phase3plus_pct:record.last_phase3plus,prior_year_cereal_production_tonnes:record.last_production,prior_year_cereal_gap_tonnes:record.last_gap} : {})}));};
  const seed42=prediction?.model_predictions?.seed_42, seed7=prediction?.model_predictions?.seed_7;
  return <div className="pageContent"><PageIntro eyebrow="MODEL INFERENCE" title="Risk Predictor" description="Estimate IPC Phase 3+ probability from pre-assessment inputs using the existing CatBoost ensemble."/>
    <div className="predictLayout"><form className="panel predictorForm" onSubmit={onPredict}><div className="panelHead"><div><span className="eyebrow">ASSESSMENT INPUTS</span><h3>County risk profile</h3></div><span className="requiredHint">All values required</span></div>
      <div className="formGrid"><Field label="State"><select required value={form.state} onChange={event=>{const state=event.target.value; const next=options?.county_state_map?.find(item=>item.state===state); const record=(data.counties || []).find(row=>row.state===state && row.county===next?.county); setForm(current=>({...current,state,county:next?.county || '',...(record ? {population:record.population,prior_period_ipc_phase:record.last_ipc,prior_period_phase3plus_pct:record.last_phase3plus,prior_year_cereal_production_tonnes:record.last_production,prior_year_cereal_gap_tonnes:record.last_gap} : {})}));}}>{states.map(value=><option key={value}>{value}</option>)}</select></Field>
      <Field label="County"><select required value={form.county} onChange={event=>changeCounty(event.target.value)}>{countyChoices.map(item=><option key={item.county}>{item.county}</option>)}</select></Field>
      <Field label="Population"><input required type="number" min="1" step="1" value={form.population} onChange={event=>setField('population',event.target.value)}/></Field>
      <Field label="Assessment year"><input required type="number" min="2010" max="2100" value={form.start_year} onChange={event=>setField('start_year',event.target.value)}/></Field>
      <Field label="Assessment month"><select required value={form.start_month} onChange={event=>setField('start_month',event.target.value)}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>{new Date(2025,index,1).toLocaleString('en',{month:'long'})}</option>)}</select></Field>
      <Field label="Previous IPC phase"><select required value={form.prior_period_ipc_phase} onChange={event=>setField('prior_period_ipc_phase',event.target.value)}>{(options?.ipc_phases || []).map(value=><option key={value}>{value}</option>)}</select></Field>
      <Field label="Previous Phase 3+ (%)"><input required type="number" min="0" max="100" step="0.1" value={form.prior_period_phase3plus_pct} onChange={event=>setField('prior_period_phase3plus_pct',event.target.value)}/></Field>
      <Field label="Previous cereal production (tonnes)"><input required type="number" min="0" step="any" value={form.prior_year_cereal_production_tonnes} onChange={event=>setField('prior_year_cereal_production_tonnes',event.target.value)}/></Field>
      <Field label="Previous cereal gap (tonnes)"><input required type="number" step="any" value={form.prior_year_cereal_gap_tonnes} onChange={event=>setField('prior_year_cereal_gap_tonnes',event.target.value)}/></Field></div>
      {selectedRecord && <p className="formHint">Selecting a county loads its latest recorded values. You can edit each input before predicting.</p>}
      {error && <div className="inlineError" role="alert">Prediction failed: {error}</div>}<button className="primaryButton wideButton" disabled={loading || !options}>{loading ? 'Running the ensemble…' : 'Generate risk estimate'} <ChevronRight size={16}/></button>
      <p className="disclaimerText">Model inputs contain nine pre-assessment features. ID and current/future target information are excluded.</p>
    </form>
    <section className={`predictionResult ${prediction ? 'hasPrediction' : ''}`} aria-live="polite">{prediction ? <><div className="resultEyebrow">FOOD INSECURITY RISK</div><div className="resultNumber">{prediction.probability_pct.toFixed(1)}<span>%</span></div><p className="resultSub">Probability of IPC Phase 3 or worse</p><div className="resultBand"><span>Analytical risk band</span><span className={`riskBand ${prediction.band_key}`}>{prediction.band?.replace(' signal','').toUpperCase()}</span></div><div className="resultMeter"><i style={{width:`${Math.min(100,prediction.probability_pct)}%`}}/></div><div className="seedRows"><div><span>Seed 42</span><b>{seed42?.toFixed(3) ?? '—'}</b></div><div><span>Seed 7</span><b>{seed7?.toFixed(3) ?? '—'}</b></div><div><span>Ensemble</span><b>{prediction.probability.toFixed(3)}</b></div><div><span>Model spread</span><b>{Math.abs(seed42-seed7).toFixed(3)}</b></div></div><ModelAgreement spread={Math.abs(seed42-seed7)}/><div className="interpretation"><b>Operational interpretation</b><p>The model estimates a {prediction.band?.toLowerCase().replace(' signal','')} probability of Crisis-or-worse food insecurity during the specified assessment period.</p><p>This signal can support further analysis, monitoring, field verification and humanitarian assessment.</p></div><ResponsibleNote/></> : <div className="resultEmpty"><div className="resultGlyph"><Target size={23}/></div><span className="eyebrow">TWO-SEED CATBOOST ENSEMBLE</span><h3>Assessment output</h3><p>Run the model to see the continuous probability and compare the two seed-level predictions.</p><div className="emptySeed"><span>42</span><span>7</span></div><small>Model output is an analytical signal, not an official IPC classification.</small></div>}</section></div>
  </div>;
}
function ModelAgreement({spread}) {const level=spread < .03 ? 'High agreement' : spread < .1 ? 'Moderate agreement' : 'Larger disagreement'; return <div className="agreement"><span>Model Agreement</span><b>{level}</b><small>Seed spread reflects differences between the two models; it is not statistical confidence.</small><div className="agreementTrack"><i style={{width:`${Math.max(8,Math.min(100,(1-spread)*100))}%`}}/></div></div>;}
function Field({label,children}) {return <label className="field"><span>{label}</span>{children}</label>;}

function CountyIntelligence({data,rows,query,setQuery,state,setState,risk,setRisk,sort,setSort,selected,setSelected,history,historyError}) {
  const [tableSort,setTableSort]=useState('risk_rate');
  useEffect(()=>{const handler=event=>setSelected(event.detail); window.addEventListener('select-county',handler); return ()=>window.removeEventListener('select-county',handler);},[setSelected]);
  const ordered=[...rows].sort((a,b)=>tableSort==='county' ? a.county.localeCompare(b.county) : tableSort==='population' ? b.population-a.population : tableSort==='observations' ? b.observations-a.observations : b.risk_rate-a.risk_rate);
  const csvRows=ordered.map(row=>({...row,risk_rate_pct:row.risk_rate*100}));
  return <div className="pageContent"><PageIntro eyebrow="COUNTY-LEVEL EVIDENCE" title="County Intelligence" description="Search and compare observed county history, previous-period indicators, population, and assessment coverage." action={<button className="secondaryButton" onClick={()=>downloadCsv('south-sudan-county-intelligence.csv',csvRows,[['county','County'],['state','State'],['population','Population'],['risk_rate_pct','Historical IPC 3+ rate (%)'],['last_ipc','Previous IPC phase'],['last_phase3plus','Previous Phase 3+ (%)'],['observations','Observations']])}><Download size={15}/>Export CSV</button>}/>
    <Panel eyebrow="HISTORICAL COUNTY RECORDS" title={`${ordered.length} counties`}><div className="filterBar"><label className="searchInput"><Search size={16}/><span className="srOnly">Search county</span><input placeholder="Search county name" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="compactSelect"><span className="srOnly">Filter by state</span><select value={state} onChange={event=>setState(event.target.value)}><option>All</option>{(data.options?.states || []).map(value=><option key={value}>{value}</option>)}</select></label><label className="compactSelect"><span className="srOnly">Filter by historical risk</span><select value={risk} onChange={event=>setRisk(event.target.value)}><option>All</option><option>CRITICAL</option><option>PRIORITY</option><option>WATCH</option></select></label><label className="compactSelect"><span className="srOnly">Sort county rows</span><select value={tableSort} onChange={event=>setTableSort(event.target.value)}><option value="risk_rate">Highest risk</option><option value="county">County name</option><option value="population">Population</option><option value="observations">Observations</option></select></label></div>
      {ordered.length ? <div className="tableScroll"><table><thead><tr><th>County</th><th>State</th><th>Population</th><th>Historical IPC 3+ rate</th><th>Previous IPC</th><th>Previous Phase 3+ %</th><th>Observations</th><th></th></tr></thead><tbody>{ordered.map(row=><tr key={`${row.state}-${row.county}`}><td><b>{row.county}</b></td><td>{row.state}</td><td>{fmt(row.population)}</td><td>{pct(row.risk_rate)}</td><td>{row.last_ipc}</td><td>{pctValue(row.last_phase3plus)}</td><td>{fmt(row.observations)}</td><td><button className="textAction" onClick={()=>setSelected(row.county)}>Inspect <ChevronRight size={13}/></button></td></tr>)}</tbody></table></div> : <EmptyState>No counties match your filters.</EmptyState>}
      <p className="disclaimerText">Historical rates reflect observed training targets. CRITICAL / PRIORITY / WATCH are dashboard-derived categories, not official IPC classifications.</p>
    </Panel>
    {selected && <Panel eyebrow="COUNTY DETAIL" title={history ? `${history.county}, ${history.state}` : selected} action={<button className="iconButton" aria-label="Close county detail" onClick={()=>setSelected('')}><X size={17}/></button>} className="detailPanel">{historyError ? <div className="inlineError">Unable to load county history: {historyError}</div> : !history ? <div className="loadingRow">Loading county history…</div> : <CountyDetail history={history}/>}</Panel>}
  </div>;
}
function CountyDetail({history}) {
  const rows=history.rows || [];
  const latest=rows.at(-1);
  const historicalRate=rows.reduce((sum,row)=>sum+row.target,0)/Math.max(rows.length,1);
  const showProduction=rows.some(row=>Number.isFinite(row.production));
  const showGap=rows.some(row=>Number.isFinite(row.gap));
  return <><div className="detailStats"><div><span>Historical IPC 3+ rate</span><b>{pct(historicalRate)}</b></div><div><span>Observations</span><b>{fmt(rows.length)}</b></div><div><span>Latest population</span><b>{fmt(latest?.population)}</b></div><div><span>Latest previous IPC</span><b>{latest?.ipc || 'Data unavailable'}</b></div></div><div className="detailCharts">
    <MiniLine title="Historical IPC 3+ outcomes" rows={rows} dataKey="target" format={value=>`${(value*100).toFixed(0)}%`}/><MiniLine title="Previous Phase 3+ percentage" rows={rows} dataKey="phase3plus_pct" format={value=>`${Number(value).toFixed(0)}%`}/><MiniLine title="Previous IPC phase timeline" rows={rows.map(row=>({...row,phaseIndex:({Minimal:1,Stressed:2,Crisis:3,Emergency:4,Famine:5,Catastrophe:5})[row.ipc] ?? null}))} dataKey="phaseIndex" format={value=>['Data unavailable','Minimal','Stressed','Crisis','Emergency','Famine / Catastrophe'][Math.round(value)] || 'Data unavailable'}/>{showProduction&&<MiniLine title="Previous cereal production (tonnes)" rows={rows} dataKey="production" format={value=>fmt(value)}/ >}{showGap&&<MiniLine title="Previous cereal gap (tonnes)" rows={rows} dataKey="gap" format={value=>fmt(value)}/ >}</div></>;
}
function MiniLine({title,rows,dataKey,format}) {return <div className="miniChart"><b>{title}</b><ResponsiveContainer width="100%" height={185}><LineChart data={rows}><CartesianGrid stroke="#263640" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="period" tick={{fill:'#819197',fontSize:9}} tickLine={false} axisLine={false} minTickGap={25}/><YAxis tickFormatter={format} tick={{fill:'#819197',fontSize:9}} tickLine={false} axisLine={false} width={52}/><Tooltip formatter={value=>[format(value),title]} labelStyle={{color:'#e6eee9'}} contentStyle={{background:'#101d24',border:'1px solid #35464a',borderRadius:4}}/><Line dataKey={dataKey} type="monotone" stroke="#74d3b0" dot={false} strokeWidth={2}/></LineChart></ResponsiveContainer></div>;}

function Atlas({rows,states,setCounty,onGo}) {const [state,setState]=useState('All'); const visibleRows=rows.filter(row=>state==='All'||row.state===state); return <div className="pageContent"><PageIntro eyebrow="GEOGRAPHIC INTELLIGENCE" title="Risk Atlas" description="A data-backed state and county matrix. No boundary files are available in this project, so this view avoids implying fabricated geographic shapes."/><Panel eyebrow="STATE / COUNTY MATRIX" title="Historical risk atlas"><div className="filterBar"><label className="compactSelect"><span className="srOnly">Filter atlas by state</span><select value={state} onChange={event=>setState(event.target.value)}><option>All</option>{states.map(value=><option key={value}>{value}</option>)}</select></label><span className="mapNote"><Map size={15}/> Matrix view · no shapefile in project</span></div><div className="atlasGrid">{visibleRows.map(row=><button key={`${row.state}-${row.county}`} className="atlasTile" onClick={()=>{setCounty(row.county);onGo('counties');}}><span className="atlasTileTop"><b>{row.county}</b><Priority value={row.priority}/></span><span className="atlasState">{row.state}</span><strong>{pct(row.risk_rate)}</strong><span className="atlasMetrics">{fmt(row.population)} population · IPC {row.last_ipc || 'unavailable'}</span></button>)}</div>{!visibleRows.length && <EmptyState>No county data available for this state.</EmptyState>}<p className="disclaimerText">Historical IPC 3+ rate, population, and prior IPC are calculated from project records. This is not a geographic boundary map.</p></Panel></div>;}

function EarlyWarning({data,onGo,onCounty}) {const alerts=data.alerts || []; const [group,setGroup]=useState('All'); const filtered=alerts.filter(row=>group==='All'||row.priority===group); return <div className="pageContent"><PageIntro eyebrow="MODEL-BASED MONITORING" title="Early Warning" description="Latest available county records scored with the existing two-seed model and ordered by ensemble probability." action={<button className="secondaryButton" onClick={()=>downloadCsv('south-sudan-early-warning.csv',filtered,[['county','County'],['state','State'],['risk_probability','Risk probability'],['prior_period_ipc_phase','Previous IPC'],['prior_period_phase3plus_pct','Previous Phase 3+ (%)'],['population','Population'],['priority','Analytical priority'],['signal_reason','Signal reason']])}><Download size={15}/>Export watchlist</button>}/><div className="warningCallout"><AlertTriangle size={17}/><span>This is an analytical prioritization signal and is not an official IPC classification or humanitarian targeting decision.</span></div><div className="segmented" role="group" aria-label="Filter alert priority">{['All','CRITICAL','PRIORITY','WATCH'].map(value=><button className={group===value?'selected':''} key={value} onClick={()=>setGroup(value)}>{value}</button>)}</div><Panel eyebrow="LATEST MODEL OUTPUTS" title={`${filtered.length} county signals`}><div className="tableScroll"><table><thead><tr><th>County</th><th>State</th><th>Risk probability</th><th>Previous IPC</th><th>Previous Phase 3+ %</th><th>Population</th><th>Priority</th><th>Signal reason</th></tr></thead><tbody>{filtered.map(row=><tr key={`${row.state}-${row.county}`}><td><button className="tableLink" onClick={()=>{onCounty(row.county);onGo('counties');}}>{row.county}</button></td><td>{row.state}</td><td><b>{pct(row.risk_probability)}</b></td><td>{row.prior_period_ipc_phase}</td><td>{pctValue(row.prior_period_phase3plus_pct)}</td><td>{fmt(row.population)}</td><td><Priority value={row.priority}/></td><td>{row.signal_reason}</td></tr>)}</tbody></table></div>{!filtered.length&&<EmptyState>No signals available.</EmptyState>}</Panel><ResponsibleNote/></div>;}

function Submission({data,rows,sort,setSort}) {const summary=data.submission?.summary; const distribution=data.distribution || []; const csv=data.submission?.rows || []; return <div className="pageContent"><PageIntro eyebrow="FINAL SUBMISSION FILE" title="Submission Analytics" description="Descriptive statistics and ranking from the project's actual final submission probabilities." action={<button className="secondaryButton" onClick={()=>downloadCsv('final-submission-predictions.csv',csv,[['ID','ID'],['food_insecurity_risk','Probability']])}><Download size={15}/>Download CSV</button>}/>
    {summary ? <div className="kpiGrid sixGrid"><Kpi icon={Database} label="Predictions" value={fmt(summary.count)} detail="Rows in final submission"/><Kpi icon={TrendingUp} label="Minimum" value={Number(summary.min).toFixed(4)} detail="Probability"/><Kpi icon={TrendingUp} label="Maximum" value={Number(summary.max).toFixed(4)} detail="Probability"/><Kpi icon={Gauge} label="Mean" value={Number(summary.mean).toFixed(4)} detail="Probability"/><Kpi icon={Target} label="Median" value={Number(summary.median).toFixed(4)} detail="Probability"/><Kpi icon={BarChart3} label="Std. deviation" value={Number(summary.std).toFixed(4)} detail="Probability"/></div> : <ApiError message="Unable to load submission analytics." onRetry={()=>location.reload()}/>}
    <Panel eyebrow="SUBMISSION DISTRIBUTION" title="Probability frequency"><div className="chartBox"><ResponsiveContainer width="100%" height={260}><BarChart data={distribution}><CartesianGrid stroke="#263640" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="range_start" tickFormatter={value=>Number(value).toFixed(2)} tick={{fill:'#819197',fontSize:10}} tickLine={false} axisLine={false}/><YAxis tick={{fill:'#819197',fontSize:10}} tickLine={false} axisLine={false}/><Tooltip formatter={(value)=>[value,'Predictions']} labelFormatter={value=>`Probability ≥ ${Number(value).toFixed(3)}`}/><Bar dataKey="count" fill="#74d3b0" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div></Panel>
    <Panel eyebrow="RANKED PREDICTIONS" title={`${rows.length} predictions`} action={<label className="compactSelect"><span className="srOnly">Sort submission table</span><select value={sort} onChange={event=>setSort(event.target.value)}><option value="probability">Highest probability</option><option value="id">ID</option></select></label>}><div className="tableScroll limitedTable"><table><thead><tr><th>Rank</th><th>ID</th><th>Probability</th></tr></thead><tbody>{rows.slice(0,100).map((row,index)=><tr key={row.ID}><td>{sort==='probability'?index+1:row.rank_within_submission}</td><td><b>{row.ID}</b></td><td>{Number(row.food_insecurity_risk).toFixed(8)}</td></tr>)}</tbody></table></div><p className="disclaimerText">Table shows the first 100 rows in the selected sort order; CSV exports all original probability values without rounding.</p></Panel>
  </div>;}

function Methodology({data}) {const overview=data.overview, features=data.features || [], quality=data.quality; return <div className="pageContent"><PageIntro eyebrow="MODEL CARD" title="Model & Methodology" description="Forecasting setup, validation evidence, inputs, and operational limitations for the existing South Sudan model."/><div className="contentGrid methodGrid"><Panel eyebrow="ALGORITHM" title="CatBoost classifier"><div className="modelFacts"><Fact label="Model" value="CatBoostClassifier ensemble"/><Fact label="Seeds" value="42 and 7"/><Fact label="Iterations" value="1,800"/><Fact label="Depth" value="7"/><Fact label="Learning rate" value="0.02"/><Fact label="L2 regularization" value="6"/><Fact label="Loss" value="Logloss"/><Fact label="Metric" value="AUC"/></div><p className="methodCopy">The ensemble averages continuous probability outputs from the two pretrained CatBoost models. Models are loaded once by the existing backend at startup; inference does not retrain them.</p></Panel><Panel eyebrow="VALIDATION" title="Chronological holdout"><div className="aucBlock"><strong>{overview?.validation_auc?.toFixed(4) ?? 'Data unavailable'}</strong><span>ROC-AUC · {overview?.validation_period || '—'}</span></div><p className="methodCopy">Chronological validation was used to better reflect the forecasting setting. Holdout: {fmt(overview?.validation_rows)} observations.</p><div className="diagnostics"><span>OPERATIONAL DIAGNOSTIC</span><Fact label={`Threshold ≈ ${overview?.f1_threshold?.toFixed(2)}`} value={`F1 ${overview?.f1?.toFixed(4)}`}/><Fact label={`Precision ${overview?.precision?.toFixed(4)}`} value={`Recall ${overview?.recall?.toFixed(4)}`}/></div><p className="methodCopy">These diagnostic metrics are not the competition score. The competition metric is ROC-AUC, so the final model retains continuous probability predictions.</p></Panel><Panel eyebrow="FEATURE IMPORTANCE" title="Model-derived relative influence"><div className="importanceList">{features.map((item,index)=><div className="importanceRow" key={item.feature}><span className="importanceRank">{String(index+1).padStart(2,'0')}</span><span className="importanceLabel">{pretty(item.feature)}</span><div className="barTrack"><i style={{width:`${Math.max(1,Math.min(100,item.importance))}%`}}/></div><b>{Number(item.importance).toFixed(2)}</b></div>)}</div><p className="disclaimerText">Feature importance indicates how influential variables were within this model. It should not be interpreted as causal evidence.</p></Panel><Panel eyebrow="DATA HEALTH" title="Dataset quality"><div className="qualityHeading"><Priority value={quality?.status || 'Data unavailable'}/><span>Status is calculated from observed data checks.</span></div><div className="qualityGrid"><Fact label="Rows / columns" value={`${fmt(quality?.rows)} / ${fmt(quality?.columns)}`}/><Fact label="Missing values" value={fmt(quality?.missing_values)}/><Fact label="Duplicate IDs" value={fmt(quality?.duplicate_ids)}/><Fact label="Counties / states" value={`${fmt(quality?.unique_counties)} / ${fmt(quality?.unique_states)}`}/><Fact label="Assessment periods" value={fmt(quality?.assessment_periods)}/><Fact label="Target distribution" value={quality?.target_distribution ? `0: ${fmt(quality.target_distribution['0'])} · 1: ${fmt(quality.target_distribution['1'])}` : 'Data unavailable'}/></div></Panel></div>
    <Panel eyebrow="NINE PREDICTIVE FEATURES" title="Pre-assessment model inputs"><div className="featureChips">{FEATURE_LABELS.map(feature=><span key={feature}>{pretty(feature)}</span>)}</div><p className="methodCopy">ID and current/future target information are excluded. Features include location, population, assessment period, previous IPC phase and prevalence, and prior-year cereal production and gap.</p></Panel><Panel eyebrow="LEAKAGE PREVENTION" title="Responsible interpretation"><div className="limitations"><p><b>Operational limits.</b> Predictions are learned from historical challenge data and may not represent current field conditions, sudden shocks, population movement, or data gaps.</p><p><b>Responsible use.</b> This system does not replace IPC analysis or humanitarian experts, determine aid eligibility, independently allocate resources, or constitute an official IPC classification. Field and expert validation is required.</p></div></Panel>
  </div>;}
function Fact({label,value}) {return <div className="fact"><span>{label}</span><b>{value ?? 'Data unavailable'}</b></div>;}
function About() {return <div className="pageContent"><PageIntro eyebrow="ABOUT THIS PLATFORM" title="South Sudan Food Security Intelligence" description="An experimental machine-learning early-warning and decision-support platform developed from the South Sudan Food Security forecasting challenge."/><div className="contentGrid aboutGrid"><Panel eyebrow="PURPOSE" title="Decision support, not determination"><p className="methodCopy">This application presents the existing forecasting model and competition data through a data-centric interface for analysts, researchers, humanitarian organizations, and development partners. Its role is to support early warning and analytical prioritization for further review.</p><div className="purposePillars"><div><Target size={18}/><b>Decision Support</b></div><div><Activity size={18}/><b>Early Warning</b></div><div><Users size={18}/><b>Analytical Prioritization</b></div></div></Panel><Panel eyebrow="TECHNOLOGY" title="Current project stack"><div className="featureChips"><span>React</span><span>Vite</span><span>FastAPI</span><span>Python</span><span>CatBoost</span><span>Pandas</span><span>NumPy</span><span>scikit-learn</span></div><p className="methodCopy">The app reuses the dependencies and backend already present in the project.</p></Panel></div><section className="responsibleBlock"><span className="eyebrow">RESPONSIBLE AI &amp; HUMANITARIAN USE</span><h3>Signals require people, evidence, and context.</h3><p>This system does not replace IPC analysis, humanitarian experts, field verification, or coordination. It does not determine aid eligibility, independently allocate humanitarian resources, or issue official IPC classifications.</p><div className="responsibleTags"><span>NOT AN IPC CLASSIFICATION</span><span>NOT AID ELIGIBILITY</span><span>FIELD VALIDATION REQUIRED</span></div></section></div>;}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App/>);
