import { useMemo } from "react";
import {
  createLibrary,
  createParser,
  defineComponent,
  Renderer,
  useGetFieldValue,
} from "@openuidev/react-lang";
import { library } from "./catalogue";

export function HydratedOpenUI({ source }: { source: string }) {
  const hydratedLibrary = useMemo(() => {
    const parsed = createParser(library.toJSONSchema()).parse(source);
    const stateNames = Object.keys(parsed.stateDeclarations);
    if (
      Object.values(parsed.stateDeclarations).some(
        (value) => value === undefined,
      )
    )
      throw new Error("OpenUI state defaults must be defined");
    return createLibrary({
      root: library.root,
      components: Object.values(library.components).map((definition) => {
        const Original = definition.component;
        return defineComponent({
          name: definition.name,
          props: definition.props,
          description: definition.description,
          component: (props) => {
            const getFieldValue = useGetFieldValue();
            // OpenUI initialises declared state in an effect after its first render.
            // Delay descendants so missing numeric state cannot be coerced to zero.
            if (
              stateNames.some(
                (name) => getFieldValue(undefined, name) === undefined,
              )
            )
              return <span role="status">Loading visual...</span>;
            return <Original {...props} />;
          },
        });
      }),
    });
  }, [source]);
  return (
    <Renderer
      response={source}
      library={hydratedLibrary}
      publishObservability={false}
    />
  );
}
