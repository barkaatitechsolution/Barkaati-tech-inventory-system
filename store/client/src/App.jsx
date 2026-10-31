import { StoreProvider } from "./lib/storeContext";
import { CartProvider } from "./lib/cartContext";
import { matchRoute, navigate, useRoute } from "./lib/router.jsx";
import Home from "./pages/Home";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import OrderSuccess from "./pages/OrderSuccess";
import TrackOrder from "./pages/TrackOrder";
import NotFound from "./pages/NotFound";

export default function App() {
  const route = matchRoute(useRoute());

  return (
    <StoreProvider>
      <CartProvider>
        {route.name === "home" && (
          <Home
            onOpenProduct={(id) => navigate(`/product/${id}`)}
            onGoCart={() => navigate("/cart")}
            onGoTrack={() => navigate("/track")}
          />
        )}
        {route.name === "product" && <Product id={route.id} onBack={() => navigate("/")} />}
        {route.name === "cart" && (
          <Cart
            onPlaced={() => navigate("/order-success")}
            onContinueShopping={() => navigate("/")}
            onGoTrack={() => navigate("/track")}
          />
        )}
        {route.name === "order-success" && <OrderSuccess onDone={() => navigate("/")} />}
        {route.name === "track" && <TrackOrder />}
        {route.name === "not-found" && <NotFound />}
      </CartProvider>
    </StoreProvider>
  );
}
