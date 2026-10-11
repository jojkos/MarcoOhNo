import { Switch, Route, Redirect } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { Home } from "@/pages/Home";
import { Join } from "@/pages/Join";
import { TvPage, PlayPage } from "@/pages/RoomPages";

const code = (raw: string) => raw.toUpperCase().slice(0, 4);

export default function App() {
  return (
    <>
      <Toaster />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/join">{() => <Join />}</Route>
        <Route path="/join/:code">{(p) => <Join key={p.code} initialCode={code(p.code)} />}</Route>
        <Route path="/tv/:code">{(p) => <TvPage key={p.code} code={code(p.code)} />}</Route>
        <Route path="/play/:code">{(p) => <PlayPage key={p.code} code={code(p.code)} />}</Route>
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
    </>
  );
}
